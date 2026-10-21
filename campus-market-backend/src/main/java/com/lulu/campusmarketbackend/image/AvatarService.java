package com.lulu.campusmarketbackend.image;

import com.lulu.campusmarketbackend.api.ApiException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 头像的存储与展示规则（PATCH /v1/auth/me 的 avatar 字段，以及所有带用户头像的响应）。
 *
 * <p>库里 {@code users.avatar} 只会是下面四种之一：
 * <ul>
 *   <li>{@code ""}：没有头像，客户端显示昵称首字；</li>
 *   <li>{@code preset:1} … {@code preset:12}：平台预设头像，由客户端在本地绘制，不请求任何第三方站点；</li>
 *   <li>{@code upload:<uuid>}：本人上传、保存时仍有效（ACTIVE）的图片（与商品图片同一套上传、归属检查）；
 *       客户端提交平台签发的签名地址时还原成这个引用；</li>
 *   <li>http(s) 地址：只有 {@code campus-market.images.allow-external=true} 时才接受新的提交（旧数据原样保留）。</li>
 * </ul>
 *
 * <p>展示时：预设、外部地址、空串原样返回；上传图片换成短时签名地址，图片已不是 ACTIVE（被隐藏 / 删除）
 * 或不再属于这位用户时返回 {@code ""}。不认识的旧值同样返回 {@code ""}，不把未经校验的字符串交给客户端。
 *
 * <p>数据库不加约束：唯一写入口是这里的 {@link #validate}；图片之后被隐藏或删除时库里的引用保留，展示层返回 {@code ""}。
 */
@Service
public class AvatarService {
    public static final String INVALID_MESSAGE = "头像无效";
    public static final String EXTERNAL_DISABLED_MESSAGE = "不支持外部头像链接，请选择预设头像或上传图片";
    public static final int PRESET_COUNT = 12;
    public static final String PRESET_PREFIX = "preset:";

    /** preset:1 … preset:12，不允许前导零、大小写变体或其他写法 */
    private static final Pattern PRESET = Pattern.compile("^preset:(?:[1-9]|1[0-2])$");
    private static final Pattern UPLOAD = Pattern.compile(
            "^upload:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$");
    /** 与改造前的头像校验一致：http(s) 开头、单行 */
    private static final Pattern EXTERNAL = Pattern.compile("^https?://.*");

    private final ImagePolicy policy;
    private final ImageService images;
    private final ImageUrlSigner signer;

    public AvatarService(ImagePolicy policy, ImageService images, ImageUrlSigner signer) {
        this.policy = policy;
        this.images = images;
        this.signer = signer;
    }

    /**
     * 校验并返回要保存的值。调用方已完成类型、去空白与长度检查。
     *
     * @param owner 修改头像的用户：上传图片必须是他本人上传、仍有效的
     */
    public String validate(UUID owner, String value) {
        if (value.isEmpty()) return "";
        if (PRESET.matcher(value).matches()) return value;
        String ref = ImagePolicy.normalize(value);
        Matcher upload = UPLOAD.matcher(ref);
        if (upload.matches()) {
            String canonical = ImageUrlSigner.REF_PREFIX + UUID.fromString(upload.group(1));
            images.requireUsable(List.of(canonical), owner, null);
            return canonical;
        }
        if (EXTERNAL.matcher(ref).matches()) {
            if (!policy.externalAllowed()) throw ApiException.badRequest(EXTERNAL_DISABLED_MESSAGE);
            return ref;
        }
        throw ApiException.badRequest(INVALID_MESSAGE);
    }

    /** 单个用户的头像展示值（上传图片最多一条查询）。 */
    public String display(Object stored, Object userId) {
        UUID image = uploadId(stored);
        Map<UUID, UUID> active = image == null ? Map.of() : images.activeOwners(List.of(image));
        return render(stored, userId, active);
    }

    /**
     * 一批行里的头像就地换成展示值：所有上传图片只查一次，与行数无关。
     *
     * @param avatarKey 头像所在的键
     * @param userKey   这一行头像所属用户 id 所在的键
     */
    public void displayAll(Collection<Map<String, Object>> rows, String avatarKey, String userKey) {
        List<UUID> ids = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            UUID id = uploadId(row.get(avatarKey));
            if (id != null) ids.add(id);
        }
        Map<UUID, UUID> active = images.activeOwners(ids);
        for (Map<String, Object> row : rows) {
            if (row.containsKey(avatarKey)) row.put(avatarKey, render(row.get(avatarKey), row.get(userKey), active));
        }
    }

    private String render(Object stored, Object userId, Map<UUID, UUID> active) {
        String value = stored == null ? "" : String.valueOf(stored);
        if (value.isEmpty() || PRESET.matcher(value).matches() || EXTERNAL.matcher(value).matches()) return value;
        UUID image = uploadId(value);
        if (image == null) return "";
        UUID owner = active.get(image);
        if (owner == null || !owner.equals(uuid(userId))) return "";
        return signer.publicUrl(ImageUrlSigner.REF_PREFIX + image);
    }

    private static UUID uploadId(Object stored) {
        if (stored == null) return null;
        Matcher m = UPLOAD.matcher(String.valueOf(stored));
        return m.matches() ? UUID.fromString(m.group(1)) : null;
    }

    private static UUID uuid(Object value) {
        if (value instanceof UUID u) return u;
        if (value == null) return null;
        try {
            return UUID.fromString(String.valueOf(value));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
