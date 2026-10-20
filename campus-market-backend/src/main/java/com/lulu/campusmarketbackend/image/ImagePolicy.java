package com.lulu.campusmarketbackend.image;

import com.lulu.campusmarketbackend.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 商品图片的统一规则：数量、大小、格式、是否允许外部链接，以及把平台自己签发的图片地址还原成引用。
 *
 * <p>上传接口、商品 / 打包 / 批量 / 草稿的图片校验与公开配置接口（GET /v1/config）都读这里的同一组常量，
 * 不在别处重复书写。
 *
 * <ul>
 *   <li>库里只存引用：{@code upload:<uuid>}（本平台上传的图片）或外部 http(s) 地址；</li>
 *   <li>客户端把响应里拿到的签名地址原样提交回来（{@code /v1/images/<uuid>?exp=…&sig=…}，
 *       或以这段路径结尾的绝对地址）时，先还原成 {@code upload:<uuid>} 再校验与保存。签名是否有效不重要——
 *       能不能用这张图由 {@link ImageService#requireUsable} 按上传人判断；</li>
 *   <li>{@code campus-market.images.allow-external=false}（环境变量 ALLOW_EXTERNAL_IMAGES）时，新提交的
 *       http(s) 图片一律 400；编辑时，这件商品（或这份草稿）原本就有的外部地址可以原样保留，旧商品照常可编辑。</li>
 * </ul>
 */
@Component
public class ImagePolicy {
    public static final int MAX_COUNT = 9;
    public static final int MAX_BYTES = 5 * 1024 * 1024;
    /** 上传接受的格式（按文件头识别）。键是 ImageIO 的格式名。 */
    static final Map<String, String> FORMATS;
    static {
        Map<String, String> formats = new LinkedHashMap<>();
        formats.put("image/jpeg", "jpeg");
        formats.put("image/png", "png");
        FORMATS = java.util.Collections.unmodifiableMap(formats);
    }
    public static final List<String> ACCEPT = List.copyOf(FORMATS.keySet());
    public static final int MAX_REF_LENGTH = 2048;
    public static final String EXTERNAL_DISABLED_MESSAGE = "不支持外部图片链接，请先上传图片";

    private static final Pattern UPLOAD_REF = Pattern.compile("^upload:[0-9a-fA-F-]{36}$");
    private static final Pattern EXTERNAL = Pattern.compile("^https?://.*", Pattern.DOTALL);
    /** 平台签发的图片地址：相对路径，或以这段路径结尾的绝对地址；查询串（exp / sig）可有可无。 */
    private static final Pattern SIGNED = Pattern.compile(
            "^(?:https?://[^/?#\\s]+(?:/[^?#\\s]*)?)?/v1/images/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\\?[^#\\s]*)?$");

    private final boolean allowExternal;

    public ImagePolicy(@Value("${campus-market.images.allow-external:true}") boolean allowExternal) {
        this.allowExternal = allowExternal;
    }

    public boolean externalAllowed() {
        return allowExternal;
    }

    /** 公开配置（GET /v1/config 的 images 部分）。 */
    public Map<String, Object> publicConfig() {
        Map<String, Object> images = new LinkedHashMap<>();
        images.put("maxCount", MAX_COUNT);
        images.put("maxBytes", MAX_BYTES);
        images.put("accept", ACCEPT);
        images.put("externalAllowed", allowExternal);
        return images;
    }

    /** 平台签发的图片地址还原成 {@code upload:<uuid>}；其他字符串原样返回。 */
    public static String normalize(String value) {
        if (value == null) return null;
        Matcher m = SIGNED.matcher(value);
        if (!m.matches()) return value;
        return ImageUrlSigner.REF_PREFIX + UUID.fromString(m.group(1));
    }

    public static boolean isExternal(String ref) {
        return ref != null && EXTERNAL.matcher(ref).matches();
    }

    /**
     * 商品（单件、打包、批量发布、草稿进入可发布状态）的图片：还原签名地址、校验格式与数量、按开关拒绝新的外部地址。
     *
     * @param keep 编辑时这件商品原本存着的引用；其中的外部地址在开关关闭时仍可保留
     */
    public List<String> productImages(Object raw, Collection<String> keep) {
        if (!(raw instanceof List<?> values) || values.size() > MAX_COUNT) throw ApiException.badRequest("图片格式无效");
        List<String> result = new ArrayList<>();
        for (Object value : values) {
            if (!(value instanceof String s) || s.length() > MAX_REF_LENGTH) throw ApiException.badRequest("图片必须是上传的图片或 HTTP(S) 地址");
            String ref = normalize(s);
            if (!(isExternal(ref) || UPLOAD_REF.matcher(ref).matches())) throw ApiException.badRequest("图片必须是上传的图片或 HTTP(S) 地址");
            requireExternalAllowed(ref, keep);
            result.add(ref);
        }
        return result;
    }

    /**
     * 草稿里的图片：草稿允许不完整，只检查形状与长度（正式校验在进入 READY 与发布时）；
     * 同样还原签名地址，并按开关拒绝新的外部地址（这份草稿原本就有的可以保留）。
     */
    public List<Object> draftImages(Object raw, Collection<String> keep) {
        if (!(raw instanceof List<?> items)) throw ApiException.badRequest("图片 格式无效");
        if (items.size() > MAX_COUNT) throw ApiException.badRequest("图片 最多 " + MAX_COUNT + " 项");
        List<Object> result = new ArrayList<>();
        for (Object item : items) {
            if (!(item instanceof String s)) throw ApiException.badRequest("图片地址 格式无效");
            if (s.length() > MAX_REF_LENGTH) throw ApiException.badRequest("图片地址 最多 " + MAX_REF_LENGTH + " 个字");
            String ref = normalize(s);
            requireExternalAllowed(ref, keep);
            result.add(ref);
        }
        return result;
    }

    private void requireExternalAllowed(String ref, Collection<String> keep) {
        if (allowExternal || !isExternal(ref)) return;
        if (keep != null && keep.contains(ref)) return;
        throw ApiException.badRequest(EXTERNAL_DISABLED_MESSAGE);
    }

    /** 引用里的上传图片 id；不是 {@code upload:<uuid>} 的返回 null。 */
    public static UUID uploadId(Object ref) {
        if (!(ref instanceof String s) || !s.startsWith(ImageUrlSigner.REF_PREFIX)) return null;
        try {
            return UUID.fromString(s.substring(ImageUrlSigner.REF_PREFIX.length()));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    static String formatName(String mime) {
        return FORMATS.get(mime);
    }
}
