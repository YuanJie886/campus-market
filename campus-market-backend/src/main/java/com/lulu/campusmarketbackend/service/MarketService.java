package com.lulu.campusmarketbackend.service;

import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.entity.*;
import com.lulu.campusmarketbackend.mapper.*;
import com.lulu.campusmarketbackend.security.AuthService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.service.DomainMapper.*;

@Service
public class MarketService {
    private static final List<String> CATEGORIES = List.of("数码电子", "教材书籍", "生活用品", "服饰鞋包", "运动户外", "其他");
    private static final List<String> CONDITIONS = List.of("全新", "几乎全新", "轻微使用痕迹", "明显使用痕迹");
    private final UserMapper users;
    private final ProductMapper products;
    private final FavoriteMapper favorites;
    private final ReferenceMapper references;
    private final CommentMapper comments;
    private final ConversationMapper conversations;
    private final MessageMapper messages;
    private final ConversationReadMapper reads;
    private final DomainMapper mapper;

    public MarketService(UserMapper users, ProductMapper products, FavoriteMapper favorites, ReferenceMapper references,
                         CommentMapper comments, ConversationMapper conversations, MessageMapper messages,
                         ConversationReadMapper reads, DomainMapper mapper) {
        this.users = users; this.products = products; this.favorites = favorites; this.references = references;
        this.comments = comments; this.conversations = conversations; this.messages = messages; this.reads = reads; this.mapper = mapper;
    }

    public Map<String, Object> user(String id, boolean own) {
        Map<String, Object> row = users.selectRowById(uuid(id)); if (row == null) throw ApiException.notFound("用户不存在"); return mapper.user(row, own);
    }

    public Map<String, Object> profile(String id, Map<String, Object> body) {
        UUID uid = uuid(id); UpdateWrapper<UserEntity> update = new UpdateWrapper<>(); update.eq("id", uid);
        if (body.containsKey("nickname")) update.set("nickname", AuthService.string(body, "nickname", 1, 40));
        if (body.containsKey("avatar")) { String avatar = AuthService.optional(body, "avatar", 2048); if (!avatar.isEmpty() && !avatar.matches("^https?://.*")) throw ApiException.badRequest("头像必须使用 HTTP(S) 地址"); update.set("avatar", avatar); }
        if (body.containsKey("campus")) update.set("campus", AuthService.campus(body.get("campus")));
        if (body.containsKey("contact")) update.set("contact", AuthService.optional(body, "contact", 100));
        if (body.keySet().stream().anyMatch(key -> !List.of("nickname", "avatar", "campus", "contact").contains(key))) throw ApiException.badRequest("资料字段无效");
        if (body.size() > 0) users.update(null, update); return user(id, true);
    }

    public List<Map<String, Object>> meetingPoints() { return references.selectMeetingPoints(); }

    public Map<String, Object> products(Map<String, String> query, String uid) {
        String category = trim(query.get("category")); if (!category.isEmpty() && !CATEGORIES.contains(category)) throw ApiException.badRequest("分类无效");
        String campus = trim(query.get("campus")); if (!campus.isEmpty()) AuthService.campus(campus);
        String condition = trim(query.get("condition")); if (!condition.isEmpty() && !CONDITIONS.contains(condition)) throw ApiException.badRequest("成色无效");
        String keyword = trim(query.get("keyword")); BigDecimal min = decimalQuery(query.get("minPrice"), "minPrice"), max = decimalQuery(query.get("maxPrice"), "maxPrice");
        String order = switch (query.getOrDefault("sort", "latest")) { case "latest" -> "created_at DESC"; case "priceAsc" -> "price ASC"; case "priceDesc" -> "price DESC"; case "views" -> "views DESC"; default -> throw ApiException.badRequest("排序方式无效"); };
        int page = integerQuery(query.get("page"), "page", 1, 10000, 1), pageSize = integerQuery(query.get("pageSize"), "pageSize", 1, 100, 100);
        UUID viewer = uid == null ? null : uuid(uid); String safeKeyword = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        long total = products.countProductRows(viewer, category, campus, condition, safeKeyword, min, max);
        List<Map<String, Object>> rows = products.selectProductRows(viewer, category, campus, condition, safeKeyword, min, max, order, pageSize, (page - 1) * pageSize);
        return map("items", rows.stream().map(row -> mapper.product(row, uid != null && uid.equals(text(row.get("seller_id"))))).toList(), "total", total, "page", page, "pageSize", pageSize);
    }

    public Map<String, Object> product(String id, String uid) {
        UUID pid = uuid(id); Map<String, Object> row = products.selectRowById(pid); if (row == null) throw ApiException.notFound("商品不存在或已下架");
        String seller = text(row.get("seller_id"));
        if ("已下架".equals(row.get("status")) && !seller.equals(uid) && (uid == null || products.selectRelatedOrderIds(pid, uuid(uid)).isEmpty())) throw ApiException.notFound("商品不存在或已下架");
        return mapper.product(row, seller.equals(uid));
    }

    @Transactional
    public Map<String, Object> createProduct(String uid, Map<String, Object> body) {
        ProductInput input = productInput(body); ProductEntity entity = new ProductEntity(); entity.setId(UUID.randomUUID()); entity.setSellerId(uuid(uid)); entity.setTitle(input.title); entity.setDescription(input.description); entity.setPrice(input.price); entity.setOriginalPrice(input.originalPrice); entity.setCategory(input.category); entity.setCondition(input.condition); entity.setCampus(input.campus); entity.setImages(input.images); entity.setContact(input.contact); entity.setStatus("在售"); entity.setViews(0);
        products.insert(entity); return mapper.product(products.selectRowById(entity.getId()), true);
    }

    @Transactional
    public Map<String, Object> updateProduct(String uid, String id, Map<String, Object> body, String status) {
        UUID pid = uuid(id); Map<String, Object> old = products.selectForUpdate(pid); if (old == null) throw ApiException.notFound("商品不存在"); if (!uid.equals(text(old.get("seller_id")))) throw ApiException.forbidden("只能修改自己的商品"); if ("预约中".equals(old.get("status"))) throw ApiException.conflict("请先处理当前预约，再修改商品");
        boolean statusSet = status != null; if (statusSet && !List.of("在售", "已售出", "已下架").contains(status)) throw ApiException.badRequest("商品状态无效");
        if (!statusSet) for (String key : body.keySet()) if (!List.of("title", "description", "price", "originalPrice", "category", "condition", "campus", "images", "contact").contains(key)) throw ApiException.badRequest("商品字段无效");
        String title = body.containsKey("title") ? AuthService.string(body, "title", 1, 100) : null, description = body.containsKey("description") ? AuthService.string(body, "description", 1, 4000) : null, category = body.containsKey("category") ? enumValue(body.get("category"), CATEGORIES, "分类") : null, condition = body.containsKey("condition") ? enumValue(body.get("condition"), CONDITIONS, "成色") : null, campus = body.containsKey("campus") ? AuthService.campus(body.get("campus")) : null, contact = body.containsKey("contact") ? AuthService.optional(body, "contact", 100) : null;
        BigDecimal price = body.containsKey("price") ? price(body.get("price")) : null, originalPrice = body.containsKey("originalPrice") && body.get("originalPrice") != null ? price(body.get("originalPrice")) : null; List<String> images = body.containsKey("images") ? images(body.get("images")) : null;
        if (statusSet || !body.isEmpty()) products.updateProductFields(pid, title, body.containsKey("title"), description, body.containsKey("description"), price, body.containsKey("price"), originalPrice, body.containsKey("originalPrice"), category, body.containsKey("category"), condition, body.containsKey("condition"), campus, body.containsKey("campus"), images, body.containsKey("images"), contact, body.containsKey("contact"), status, statusSet, statusSet && "已售出".equals(status) ? java.sql.Timestamp.from(Instant.now()) : null);
        return mapper.product(products.selectRowById(pid), true);
    }

    public List<Map<String, Object>> favorites(String uid) { return favorites.selectRowsByUser(uuid(uid)).stream().map(mapper::favorite).toList(); }

    @Transactional
    public Map<String, Object> favorite(String uid, String id) {
        product(id, uid); UUID userId = uuid(uid), productId = uuid(id); if (favorites.deleteByUserAndProduct(userId, productId) > 0) return map("active", false); FavoriteEntity entity = new FavoriteEntity(); entity.setId(UUID.randomUUID()); entity.setUserId(userId); entity.setProductId(productId); favorites.insert(entity); return map("active", true);
    }

    public List<Map<String, Object>> comments(String id, String uid) { product(id, uid); return comments.selectRowsByProduct(uuid(id)).stream().map(mapper::comment).toList(); }

    public Map<String, Object> comment(String uid, String id, Map<String, Object> body) {
        product(id, uid); String content = AuthService.string(body, "content", 1, 2000); UUID parentId = body.get("parentId") == null ? null : uuid(String.valueOf(body.get("parentId"))); if (parentId != null && comments.countRootByIdAndProduct(parentId, uuid(id)) == 0) throw ApiException.badRequest("回复对象无效");
        CommentEntity entity = new CommentEntity(); entity.setId(UUID.randomUUID()); entity.setProductId(uuid(id)); entity.setUserId(uuid(uid)); entity.setContent(content); entity.setParentId(parentId); comments.insert(entity); return mapper.comment(commentRow(entity.getId()));
    }

    public List<Map<String, Object>> conversations(String uid) { return conversations.selectRowsByUser(uuid(uid)).stream().map(mapper::conversation).toList(); }

    @Transactional
    public Map<String, Object> conversation(String uid, String productId) {
        Map<String, Object> p = product(productId, uid); if (uid.equals(text(p.get("sellerId")))) throw ApiException.badRequest("不能咨询自己的商品"); UUID id = UUID.randomUUID(); conversations.insertOrReuse(id, uuid(productId), uuid(uid), uuid(text(p.get("sellerId")))); return mapper.conversation(conversations.selectRowByProductAndBuyer(uuid(productId), uuid(uid)));
    }

    public List<Map<String, Object>> messages(String uid, String id) { member(uid, id); return messages.selectRowsByConversation(uuid(id)).stream().map(mapper::message).toList(); }

    @Transactional
    public Map<String, Object> message(String uid, String id, Map<String, Object> body) {
        String content = AuthService.string(body, "content", 1, 2000); member(uid, id); MessageEntity entity = new MessageEntity(); entity.setId(UUID.randomUUID()); entity.setConversationId(uuid(id)); entity.setSenderId(uuid(uid)); entity.setContent(content); messages.insert(entity); conversations.touch(uuid(id)); return mapper.message(messageRow(entity.getId()));
    }

    @Transactional public void read(String uid, String id) { member(uid, id); reads.markRead(uuid(id), uuid(uid)); }
    public Map<String, Object> unread(String uid) { return map("count", messages.countUnread(uuid(uid))); }

    private Map<String, Object> commentRow(UUID id) { return comments.selectById(id) == null ? null : map("id", id, "product_id", comments.selectById(id).getProductId(), "user_id", comments.selectById(id).getUserId(), "content", comments.selectById(id).getContent(), "parent_id", comments.selectById(id).getParentId(), "created_at", comments.selectById(id).getCreatedAt()); }
    private Map<String, Object> messageRow(UUID id) { MessageEntity e = messages.selectById(id); return map("id", id, "conversation_id", e.getConversationId(), "sender_id", e.getSenderId(), "content", e.getContent(), "created_at", e.getCreatedAt()); }
    private void member(String uid, String cid) { if (conversations.countMember(uuid(cid), uuid(uid)) == 0) throw ApiException.forbidden("无权访问会话"); }
    private ProductInput productInput(Map<String, Object> body) { if (body.keySet().stream().anyMatch(key -> !List.of("title", "description", "price", "originalPrice", "category", "condition", "campus", "images", "contact").contains(key))) throw ApiException.badRequest("商品字段无效"); return new ProductInput(AuthService.string(body, "title", 1, 100), AuthService.string(body, "description", 1, 4000), price(body.get("price")), body.get("originalPrice") == null ? null : price(body.get("originalPrice")), enumValue(body.get("category"), CATEGORIES, "分类"), enumValue(body.get("condition"), CONDITIONS, "成色"), AuthService.campus(body.get("campus")), images(body.get("images")), AuthService.optional(body, "contact", 100)); }
    private List<String> images(Object raw) { if (!(raw instanceof List<?> values) || values.size() > 9) throw ApiException.badRequest("图片格式无效"); List<String> result = new ArrayList<>(); for (Object value : values) { if (!(value instanceof String s) || s.length() > 2048 || !s.matches("^https?://.*")) throw ApiException.badRequest("图片必须使用 HTTP(S) 地址"); result.add(s); } return result; }
    private BigDecimal price(Object raw) { if (!(raw instanceof Number) && !(raw instanceof String)) throw ApiException.badRequest("价格无效"); try { BigDecimal value = new BigDecimal(String.valueOf(raw)); if (value.signum() < 0 || value.compareTo(new BigDecimal("99999999")) > 0 || value.scale() > 2) throw new Exception(); return value; } catch (Exception e) { throw ApiException.badRequest("价格最多两位小数"); } }
    private String enumValue(Object raw, List<String> allowed, String label) { String value = raw == null ? "" : String.valueOf(raw); if (!allowed.contains(value)) throw ApiException.badRequest(label + "无效"); return value; }
    private static UUID uuid(Object value) { try { return UUID.fromString(String.valueOf(value)); } catch (Exception e) { throw ApiException.badRequest("ID 格式无效"); } }
    private static String trim(String value) { return value == null ? "" : value.trim(); }
    private static BigDecimal decimalQuery(String value, String name) { if (value == null || value.isBlank()) return null; try { BigDecimal d = new BigDecimal(value); if (d.signum() < 0) throw new Exception(); return d; } catch (Exception e) { throw ApiException.badRequest(name + " 无效"); } }
    private static int integerQuery(String value, String name, int min, int max, int fallback) { if (value == null || value.isBlank()) return fallback; try { int n = Integer.parseInt(value); if (n < min || n > max) throw new Exception(); return n; } catch (Exception e) { throw ApiException.badRequest(name + " 无效"); } }
    private record ProductInput(String title, String description, BigDecimal price, BigDecimal originalPrice, String category, String condition, String campus, List<String> images, String contact) {}
}
