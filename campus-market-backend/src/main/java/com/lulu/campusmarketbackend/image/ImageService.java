package com.lulu.campusmarketbackend.image;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.school.SchoolScope;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 阶段 4：商品图片上传。
 *
 * <ul>
 *   <li>只接受 JPEG / PNG（按文件头判断，不信任文件名与 Content-Type），最大 5 MB；</li>
 *   <li>先只读文件头里的宽高（不解码像素）：超过 6000×6000 直接拒绝，防止解压炸弹；</li>
 *   <li>服务端重新编码为 JPEG：不保留 EXIF、定位或任何其他元数据；最长边缩到 1600 像素；透明背景铺白；</li>
 *   <li>文件名是随机 id；读取用短时签名地址（{@link ImageUrlSigner}），商品只能引用卖家或协助人本人上传的图片（V19 数据库检查）；</li>
 *   <li>按用户限流。</li>
 * </ul>
 */
@Service
public class ImageService {
    /** 与 GET /v1/config 公布的值同源（{@link ImagePolicy}） */
    public static final int MAX_BYTES = ImagePolicy.MAX_BYTES;
    private static final int MAX_SOURCE_EDGE = 6000;
    private static final int MAX_OUTPUT_EDGE = 1600;

    private final JdbcTemplate jdbc;
    private final ImageStore store;
    private final ImageUrlSigner signer;
    private final RateLimitService rateLimit;
    private final SchoolScope schools;

    public ImageService(JdbcTemplate jdbc, ImageStore store, ImageUrlSigner signer, RateLimitService rateLimit, SchoolScope schools) {
        this.jdbc = jdbc; this.store = store; this.signer = signer; this.rateLimit = rateLimit; this.schools = schools;
    }

    public Map<String, Object> upload(String uid, byte[] raw) {
        if (raw == null || raw.length == 0) throw ApiException.badRequest("请选择一张图片");
        if (raw.length > MAX_BYTES) throw new ApiException(413, "图片不能超过 5 MB");
        String mime = sniff(raw);
        if (mime == null || !ImagePolicy.ACCEPT.contains(mime)) throw ApiException.badRequest("只支持 JPEG 或 PNG 图片");
        String format = ImagePolicy.formatName(mime);
        rateLimit.consume(RateLimitService.Scope.IMAGE_UPLOAD, uid);
        BufferedImage source = decode(raw, format);
        BufferedImage output = normalize(source);
        byte[] jpeg = encodeJpeg(output);
        UUID id = UUID.randomUUID();
        store.put(id, jpeg);
        try {
            jdbc.update("INSERT INTO uploaded_images(id, owner_user_id, school_id, sha256, byte_size, width, height, content_type) VALUES (?,?,?,?,?,?,?,'image/jpeg')",
                    id, UUID.fromString(uid), schools.schoolOf(uid), sha256(jpeg), jpeg.length, output.getWidth(), output.getHeight());
        } catch (RuntimeException e) {
            store.delete(id);
            throw e;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id.toString());
        result.put("ref", ImageUrlSigner.REF_PREFIX + id);
        result.put("url", signer.publicUrl(ImageUrlSigner.REF_PREFIX + id));
        result.put("width", output.getWidth());
        result.put("height", output.getHeight());
        return result;
    }

    /** 签名有效、图片仍有效才返回；其余（伪造、过期、隐藏、删除、不存在）一律同一个 404。 */
    public Optional<byte[]> read(String id, String exp, String sig) {
        UUID imageId;
        long expires;
        try {
            imageId = UUID.fromString(id);
            expires = Long.parseLong(exp);
        } catch (Exception e) {
            return Optional.empty();
        }
        if (!signer.verify(imageId, expires, sig)) return Optional.empty();
        List<String> status = jdbc.queryForList("SELECT status FROM uploaded_images WHERE id=?", String.class, imageId);
        if (status.isEmpty() || !"ACTIVE".equals(status.get(0))) return Optional.empty();
        return store.get(imageId);
    }

    /** 发布 / 编辑前的应用层检查（数据库在提交时再兜底一次），给出可读的 400 而不是提交失败。 */
    public void requireUsable(List<String> images, UUID seller, UUID assistant) {
        if (images == null) return;
        for (String ref : images) {
            if (!ref.startsWith(ImageUrlSigner.REF_PREFIX)) continue;
            UUID id;
            try { id = UUID.fromString(ref.substring(ImageUrlSigner.REF_PREFIX.length())); }
            catch (IllegalArgumentException e) { throw ApiException.badRequest("图片无效，请重新上传"); }
            Boolean ok = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM uploaded_images WHERE id=? AND status='ACTIVE' AND owner_user_id IN (?, ?))",
                    Boolean.class, id, seller, assistant == null ? seller : assistant);
            if (!Boolean.TRUE.equals(ok)) throw ApiException.badRequest("只能使用自己上传的图片，请重新上传");
        }
    }

    /**
     * 一组上传图片中仍有效（ACTIVE）的那些及其上传人。一条语句，与图片数量无关；
     * 草稿响应据此只给「草稿所有者本人上传、仍有效」的图片签名。
     */
    public Map<UUID, UUID> activeOwners(java.util.Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) return Map.of();
        String array = "{" + String.join(",", ids.stream().map(UUID::toString).distinct().toList()) + "}";
        Map<UUID, UUID> result = new java.util.HashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT id, owner_user_id FROM uploaded_images WHERE id = ANY(?::uuid[]) AND status='ACTIVE'", array)) {
            result.put((UUID) row.get("id"), (UUID) row.get("owner_user_id"));
        }
        return result;
    }

    /** 注销时：本人上传的图片不再可读。 */
    public int deleteAllOf(UUID owner) {
        return jdbc.update("UPDATE uploaded_images SET status='DELETED', status_changed_at=clock_timestamp() WHERE owner_user_id=? AND status<>'DELETED'", owner);
    }

    /** 按文件头识别格式，返回 MIME 类型（不信任文件名与 Content-Type）。 */
    static String sniff(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return "image/jpeg";
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return "image/png";
        return null;
    }

    private static BufferedImage decode(byte[] raw, String format) {
        try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(raw))) {
            Iterator<ImageReader> readers = ImageIO.getImageReadersByFormatName(format);
            if (input == null || !readers.hasNext()) throw ApiException.badRequest("图片无法识别");
            ImageReader reader = readers.next();
            try {
                reader.setInput(input, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE) {
                    throw ApiException.badRequest("图片尺寸不能超过 " + MAX_SOURCE_EDGE + "×" + MAX_SOURCE_EDGE);
                }
                BufferedImage image = reader.read(0);
                if (image == null) throw ApiException.badRequest("图片无法识别");
                return image;
            } finally {
                reader.dispose();
            }
        } catch (ApiException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw ApiException.badRequest("图片已损坏或无法识别");
        }
    }

    private static BufferedImage normalize(BufferedImage source) {
        double scale = Math.min(1.0, (double) MAX_OUTPUT_EDGE / Math.max(source.getWidth(), source.getHeight()));
        int width = Math.max(1, (int) Math.round(source.getWidth() * scale)), height = Math.max(1, (int) Math.round(source.getHeight() * scale));
        BufferedImage output = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = output.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.setColor(java.awt.Color.WHITE);
            g.fillRect(0, 0, width, height);
            g.drawImage(source, 0, 0, width, height, null);
        } finally {
            g.dispose();
        }
        return output;
    }

    private static byte[] encodeJpeg(BufferedImage image) {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (MemoryCacheImageOutputStream out = new MemoryCacheImageOutputStream(bytes)) {
            writer.setOutput(out);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(0.85f);
            // 不传入任何元数据：输出里只有像素
            writer.write(null, new IIOImage(image, null, null), param);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        } finally {
            writer.dispose();
        }
        return bytes.toByteArray();
    }

    private static String sha256(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
