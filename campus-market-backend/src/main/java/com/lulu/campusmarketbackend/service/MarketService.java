package com.lulu.campusmarketbackend.service;

import com.lulu.campusmarketbackend.school.SchoolScope;

import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.entity.*;
import com.lulu.campusmarketbackend.mapper.*;
import com.lulu.campusmarketbackend.security.AuthService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.service.DomainMapper.*;

@Service
public class MarketService {
    public static final List<String> CATEGORIES = List.of("数码电子", "教材书籍", "生活用品", "服饰鞋包", "运动户外", "其他");
    /** 留言允许的字段。userId / createdAt / productId 等一律拒绝。 */
    private static final java.util.Set<String> COMMENT_FIELDS = java.util.Set.of("content", "parentId");
    /** 发消息允许的字段。senderId / conversationId / createdAt 等一律拒绝。 */
    private static final java.util.Set<String> MESSAGE_FIELDS = java.util.Set.of("content");
    /** 创建会话允许的字段。buyerId / sellerId 等一律拒绝。 */
    public static final java.util.Set<String> CONVERSATION_FIELDS = java.util.Set.of("productId");
    /** 商品状态流转允许的字段。sellerId / soldAt 等一律拒绝。 */
    private static final java.util.Set<String> PRODUCT_STATUS_FIELDS = java.util.Set.of("status");
    /** 商品创建/编辑允许的字段。sellerId / status / views / soldAt 等一律拒绝。 */
    private static final java.util.Set<String> PRODUCT_FIELDS = java.util.Set.of(
            "title", "description", "price", "originalPrice", "category", "condition", "campus", "images", "contact",
            "buildingId", "inspection", "textbookEditionId",
            // 模块 5：单件 / 整套打包；打包明细
            "listingKind", "bundleItems",
            // 模块 6：全校公开 / 圈子可见；目标圈子
            "visibility", "circleIds");
    public static final List<String> LISTING_KINDS = List.of("SINGLE", "BUNDLE");
    /** 模块 4：只有这个分类的商品可以关联教材版本。 */
    public static final String TEXTBOOK_CATEGORY = "教材书籍";
    /** 个人资料允许的字段。id / role / account / createdAt 等一律拒绝。 */
    private static final java.util.Set<String> PROFILE_FIELDS =
            java.util.Set.of("nickname", "avatar", "campus", "contact", "dormBuildingId");

    public static final List<String> CONDITIONS = List.of("全新", "几乎全新", "轻微使用痕迹", "明显使用痕迹");
    private final UserMapper users;
    private final ProductMapper products;
    private final FavoriteMapper favorites;
    private final ReferenceMapper references;
    private final CommentMapper comments;
    private final ConversationMapper conversations;
    private final MessageMapper messages;
    private final ConversationReadMapper reads;
    private final DomainMapper mapper;
    private final com.lulu.campusmarketbackend.building.BuildingService buildings;
    private final com.lulu.campusmarketbackend.building.BuildingFeedService feeds;
    private final com.lulu.campusmarketbackend.demand.DemandMatchService demandMatches;
    private final com.lulu.campusmarketbackend.inspection.InspectionService inspections;
    private final com.lulu.campusmarketbackend.textbook.CatalogService catalogService;
    private final com.lulu.campusmarketbackend.mapper.CatalogMapper catalog;
    private final com.lulu.campusmarketbackend.supply.BundleService bundles;
    private final com.lulu.campusmarketbackend.circle.ProductVisibility visibility;

    private final com.lulu.campusmarketbackend.school.SchoolScope schools;
    private final com.lulu.campusmarketbackend.governance.RestrictionGuard restrictions;

    public MarketService(UserMapper users, ProductMapper products, FavoriteMapper favorites, ReferenceMapper references,
                         CommentMapper comments, ConversationMapper conversations, MessageMapper messages,
                         ConversationReadMapper reads, DomainMapper mapper,
                         com.lulu.campusmarketbackend.building.BuildingService buildings,
                         com.lulu.campusmarketbackend.building.BuildingFeedService feeds,
                         com.lulu.campusmarketbackend.demand.DemandMatchService demandMatches,
                         com.lulu.campusmarketbackend.inspection.InspectionService inspections,
                         com.lulu.campusmarketbackend.textbook.CatalogService catalogService,
                         com.lulu.campusmarketbackend.mapper.CatalogMapper catalog,
                         com.lulu.campusmarketbackend.supply.BundleService bundles,
                         com.lulu.campusmarketbackend.circle.ProductVisibility visibility,
                         com.lulu.campusmarketbackend.school.SchoolScope schools,
                         com.lulu.campusmarketbackend.governance.RestrictionGuard restrictions) {
        this.schools = schools;
        this.restrictions = restrictions;
        this.users = users; this.products = products; this.favorites = favorites; this.references = references;
        this.comments = comments; this.conversations = conversations; this.messages = messages; this.reads = reads;
        this.mapper = mapper; this.buildings = buildings; this.feeds = feeds;
        this.demandMatches = demandMatches;
        this.inspections = inspections;
        this.catalogService = catalogService;
        this.catalog = catalog;
        this.bundles = bundles;
        this.visibility = visibility;
    }

    /**
     * 列出某校区的可选楼栋。公共参考数据，未登录也能读——
     * 发布页和筛选器在登录前就需要它，而它不含任何住户信息。
     */
    public List<Map<String, Object>> buildings(String campus, String zone) {
        return buildings.list(schools.requireCampus(campus), trim(zone));
    }

    /**
     * 楼栋集市 feed。
     *
     * <p>单独开一个端点而不是改 {@code /v1/products}：旧客户端期望的是
     * {items,total,page,pageSize}，而 feed 还要返回 scope 元数据。
     * 往旧响应里塞字段看似兼容，实际会让「这次到底用了哪个范围」变成隐式约定。
     */
    public Map<String, Object> feed(Map<String, String> query, String uid) {
        SchoolScope.rejectSchoolOverride(query);
        String category = trim(query.get("category"));
        if (!category.isEmpty() && !CATEGORIES.contains(category)) throw ApiException.badRequest("分类无效");
        String condition = trim(query.get("condition"));
        if (!condition.isEmpty() && !CONDITIONS.contains(condition)) throw ApiException.badRequest("成色无效");
        String keyword = trim(query.get("keyword"));
        String safeKeyword = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
        BigDecimal min = decimalQuery(query.get("minPrice"), "minPrice");
        BigDecimal max = decimalQuery(query.get("maxPrice"), "maxPrice");
        String orderBy = switch (query.getOrDefault("sort", "latest")) {
            case "latest" -> "p.created_at DESC";
            case "priceAsc" -> "p.price ASC";
            case "priceDesc" -> "p.price DESC";
            case "views" -> "p.views DESC";
            case "nearest" -> "nearest";
            default -> throw ApiException.badRequest("排序方式无效");
        };
        int page = integerQuery(query.get("page"), "page", 1, 10000, 1);
        int pageSize = integerQuery(query.get("pageSize"), "pageSize", 1, 100, 20);

        return feeds.feed(new com.lulu.campusmarketbackend.building.BuildingFeedService.FeedQuery(
                category, condition, safeKeyword, min, max,
                com.lulu.campusmarketbackend.building.BuildingScope.parse(query.get("scope")),
                orderBy, page, pageSize), uid);
    }

    public Map<String, Object> user(String id, boolean own) {
        Map<String, Object> row = users.selectRowById(uuid(id)); if (row == null) throw ApiException.notFound("用户不存在"); return mapper.user(row, own);
    }

    /** 6.1A：他人公开资料只对同校登录用户可见；他校与不存在是同一个 404。 */
    public Map<String, Object> publicUser(String viewer, String id) {
        UUID target;
        try { target = UUID.fromString(id); } catch (IllegalArgumentException e) { throw ApiException.notFound("用户不存在"); }
        String school = references.selectUserSchool(target);
        if (school == null || !school.equals(schools.schoolOf(viewer))) throw ApiException.notFound("用户不存在");
        return user(id, false);
    }

    public Map<String, Object> profile(String id, Map<String, Object> body) {
        UUID uid = uuid(id); UpdateWrapper<UserEntity> update = new UpdateWrapper<>(); update.eq("id", uid);
        if (body.containsKey("nickname")) update.set("nickname", AuthService.string(body, "nickname", 1, 40));
        if (body.containsKey("avatar")) { String avatar = AuthService.optional(body, "avatar", 2048); if (!avatar.isEmpty() && !avatar.matches("^https?://.*")) throw ApiException.badRequest("头像必须使用 HTTP(S) 地址"); update.set("avatar", avatar); }
        // 6.1A：只能在本校校区之间切换；换到他校校区等于绕过学校隔离，与不存在的校区同为 400
        String ownSchool = body.containsKey("campus") ? schools.schoolOf(id) : null;
        if (body.containsKey("campus")) update.set("campus", schools.requireCampusInSchool(body.get("campus"), ownSchool));
        if (body.containsKey("contact")) update.set("contact", AuthService.optional(body, "contact", 100));
        if (body.containsKey("dormBuildingId")) {
            Object raw = body.get("dormBuildingId");
            if (raw == null || String.valueOf(raw).isBlank()) {
                // 显式清空是受支持的操作：用户有权收回这条信息
                update.set("dorm_building_id", null);
            } else {
                // 同时改 campus 时按<b>新</b>校区校验，否则按库中现值。
                // 反过来（按旧校区校验）会让「搬到西校区并选西校区楼栋」这一步必然失败。
                String campus = body.containsKey("campus")
                        ? schools.requireCampusInSchool(body.get("campus"), ownSchool)
                        : users.selectCampus(uid);
                update.set("dorm_building_id", buildings.requireSelectable(String.valueOf(raw), campus));
            }
        }
        JsonFieldPolicy.rejectUnknown(body, PROFILE_FIELDS);
        if (body.size() > 0) users.update(null, update); return user(id, true);
    }

    /** 稳定面交点。V3 起附带演示坐标，字段 campus 保持原名以兼容旧客户端。 */
    public List<Map<String, Object>> meetingPoints() {
        return references.selectMeetingPoints().stream().map(mapper::meetingPoint).toList();
    }

    public Map<String, Object> products(Map<String, String> query, String uid) {
        String category = trim(query.get("category")); if (!category.isEmpty() && !CATEGORIES.contains(category)) throw ApiException.badRequest("分类无效");
        SchoolScope.rejectSchoolOverride(query);
        String campus = trim(query.get("campus")); if (!campus.isEmpty()) schools.requireCampusInSchool(campus, schools.schoolOf(uid));
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
        UUID pid = uuid(id); UUID viewer = uid == null ? null : uuid(uid);
        Map<String, Object> row = products.selectRowForViewer(pid, viewer); if (row == null) throw ApiException.notFound("商品不存在或已下架");
        // 模块 6：私密商品对无权查看的人与不存在完全一样（同一个 404、同一句话），不透露它是否存在
        if (!Boolean.TRUE.equals(row.get("readable"))) throw ApiException.notFound("商品不存在或已下架");
        String seller = text(row.get("seller_id"));
        if ("已下架".equals(row.get("status")) && !seller.equals(uid) && (uid == null || products.selectRelatedOrderIds(pid, uuid(uid)).isEmpty())) throw ApiException.notFound("商品不存在或已下架");
        Map<String, Object> result = new java.util.LinkedHashMap<>(mapper.product(row, seller.equals(uid)));
        // 卖家对每个验货条目的当前声明；没有声明的旧商品为 null，前端如实提示
        result.put("inspection", inspections.productDisclosure(pid));
        // 模块 5：整套打包的全部明细（一条 SQL，与明细数量无关）；单件商品为 null
        result.put("bundleItems", "BUNDLE".equals(text(row.get("listing_kind"))) ? bundles.items(pid) : null);
        return result;
    }

    /** 某分类的当前验货模板；不支持的分类返回 null。 */
    public Map<String, Object> inspectionTemplate(String category) {
        String value = trim(category);
        if (!CATEGORIES.contains(value)) throw ApiException.badRequest("分类无效");
        return inspections.currentTemplate(value);
    }

    /**
     * 发布商品。商品写入与需求匹配在同一事务里：返回成功时匹配已经提交，
     * 匹配失败则商品一并回滚。
     */
    @Transactional
    public Map<String, Object> createProduct(String uid, Map<String, Object> body) {
        UUID seller = uuid(uid);
        return createProductAs(seller, body, seller, null);
    }

    /**
     * 以所有者身份发布一件商品（单件或整套打包）。批量发布逐条调用它，与需求匹配同处一个事务。
     *
     * @param publishedBy 最终点击发布的人——必须是所有者本人（数据库 CHECK 同样保证）
     * @param assistedBy  可选：协助整理内容的人，只做记录
     */
    @Transactional
    public Map<String, Object> createProductAs(UUID sellerId, Map<String, Object> body, UUID publishedBy, UUID assistedBy) {
        if (!sellerId.equals(publishedBy)) throw ApiException.forbidden("只有商品所有者可以发布");
        // 模块 7：单件、打包、批量、草稿最终发布都经过这里
        restrictions.require(sellerId, "PUBLISHING");
        ProductInput input = productInput(body, schools.schoolOf(sellerId.toString()));
        String kind = listingKind(body.get("listingKind"));
        // 模块 6：默认全校公开；圈子可见必须主动选择 1～5 个圈子，卖家（所有者）必须是每个圈子的在籍成员。
        // 协助整理的人不能借此选择所有者无权访问的圈子——这里校验的永远是所有者本人。
        com.lulu.campusmarketbackend.circle.ProductVisibility.Choice choice =
                com.lulu.campusmarketbackend.circle.ProductVisibility.parse(body.get("visibility"), body.get("circleIds"));
        visibility.requirePublishable(sellerId, input.campus, choice);
        com.lulu.campusmarketbackend.inspection.InspectionService.Disclosure disclosure = null;
        List<com.lulu.campusmarketbackend.mapper.BundleMapper.ItemRow> bundleItems = null;
        Map<String, Object> edition = null;
        if ("BUNDLE".equals(kind)) {
            // 打包商品按每条明细验货（下单时生成），不接受商品级验货清单；也不关联单一教材版本
            if (body.get("inspection") != null) throw ApiException.badRequest("整套打包商品按每条明细验货，不需要提交商品级验货清单");
            if (body.get("textbookEditionId") != null && !String.valueOf(body.get("textbookEditionId")).isBlank()) {
                throw ApiException.badRequest("整套打包商品不能关联单一教材版本");
            }
            bundleItems = bundles.parse(body.get("bundleItems"));
        } else {
            if (body.get("bundleItems") != null) throw ApiException.badRequest("只有整套打包商品可以提交明细");
            // 验货声明在任何写入之前校验：受支持的分类必须逐项表态，不支持的分类不接受清单
            disclosure = inspections.parseDisclosure(input.category, body.get("inspection"));
            // 教材版本在写入前校验（分类、学校、目录中存在），写入后关联并保存快照
            edition = body.containsKey("textbookEditionId")
                    ? resolveTextbook(body.get("textbookEditionId"), input.category, input.campus) : null;
        }
        ProductEntity entity = new ProductEntity(); entity.setId(UUID.randomUUID()); entity.setSellerId(sellerId); entity.setTitle(input.title); entity.setDescription(input.description); entity.setPrice(input.price); entity.setOriginalPrice(input.originalPrice); entity.setCategory(input.category); entity.setCondition(input.condition); entity.setCampus(input.campus); entity.setBuildingId(input.buildingId); entity.setImages(input.images); entity.setContact(input.contact); entity.setStatus("在售"); entity.setViews(0);
        entity.setListingKind(kind); entity.setPublishedBy(publishedBy); entity.setAssistedBy(assistedBy);
        entity.setVisibility(choice.visibility());
        products.insert(entity);
        if (choice.circleOnly()) visibility.replaceLinks(entity.getId(), choice);
        if (bundleItems != null) bundles.replace(entity.getId(), bundleItems);
        else inspections.replaceDisclosure(entity.getId(), disclosure);
        if (edition != null) linkTextbook(entity.getId(), edition);
        demandMatches.evaluate(entity.getId());
        // 刻意不返回命中订阅数：卖家可以借它试探有多少人想要，进而抬价
        return mapper.product(products.selectRowForViewer(entity.getId(), sellerId), true);
    }

    @Transactional
    public Map<String, Object> updateProduct(String uid, String id, Map<String, Object> body, String status) {
        UUID pid = uuid(id); Map<String, Object> old = products.selectForUpdate(pid); if (old == null) throw ApiException.notFound("商品不存在"); if (!uid.equals(text(old.get("seller_id")))) throw ApiException.forbidden("只能修改自己的商品"); if ("预约中".equals(old.get("status"))) throw ApiException.conflict("请先处理当前预约，再修改商品");
        boolean statusSet = status != null; if (statusSet) JsonFieldPolicy.rejectUnknown(body, PRODUCT_STATUS_FIELDS);
        if (statusSet && !List.of("在售", "已售出", "已下架").contains(status)) throw ApiException.badRequest("商品状态无效");
        if (!statusSet) JsonFieldPolicy.rejectUnknown(body, PRODUCT_FIELDS);
        // 模块 5：单件 / 打包发布后不可互换（数据库触发器同样保证）；打包商品只接受整体替换明细
        String currentKind = old.get("listing_kind") == null ? "SINGLE" : text(old.get("listing_kind"));
        boolean bundle = "BUNDLE".equals(currentKind);
        if (!statusSet && body.containsKey("listingKind") && !currentKind.equals(String.valueOf(body.get("listingKind")))) {
            throw ApiException.badRequest("发布后不能在单件与整套打包之间切换");
        }
        List<com.lulu.campusmarketbackend.mapper.BundleMapper.ItemRow> bundleItems = null;
        if (!statusSet && bundle) {
            if (body.get("inspection") != null) throw ApiException.badRequest("整套打包商品按每条明细验货，不需要提交商品级验货清单");
            if (body.get("textbookEditionId") != null) throw ApiException.badRequest("整套打包商品不能关联单一教材版本");
            if (body.containsKey("bundleItems")) bundleItems = bundles.parse(body.get("bundleItems"));
        } else if (!statusSet && body.containsKey("bundleItems")) {
            throw ApiException.badRequest("只有整套打包商品可以提交明细");
        }
        String title = body.containsKey("title") ? AuthService.string(body, "title", 1, 100) : null, description = body.containsKey("description") ? AuthService.string(body, "description", 1, 4000) : null, category = body.containsKey("category") ? enumValue(body.get("category"), CATEGORIES, "分类") : null, condition = body.containsKey("condition") ? enumValue(body.get("condition"), CONDITIONS, "成色") : null, campus = body.containsKey("campus") ? schools.requireCampusInSchool(body.get("campus"), schools.schoolOf(uid)) : null, contact = body.containsKey("contact") ? AuthService.optional(body, "contact", 100) : null;
        BigDecimal price = body.containsKey("price") ? price(body.get("price")) : null, originalPrice = body.containsKey("originalPrice") && body.get("originalPrice") != null ? price(body.get("originalPrice")) : null; List<String> images = body.containsKey("images") ? images(body.get("images")) : null;
        String buildingId = resolveProductBuilding(body, old, campus);
        // 验货声明：
        //  * 切换分类 → 必须按新分类重新声明（不支持的分类则清空），绝不沿用旧分类的声明；
        //  * 分类不变且提交了 inspection → 按当前模板整体替换；
        //  * 否则保留原声明（包括没有声明的旧商品，照常可编辑）。
        // 已生成订单的验货快照与这里无关，不会被改写。
        boolean categoryChanged = category != null && !category.equals(text(old.get("category")));
        boolean replaceDisclosure = !statusSet && !bundle && (categoryChanged || body.containsKey("inspection"));
        com.lulu.campusmarketbackend.inspection.InspectionService.Disclosure disclosure = replaceDisclosure
                ? inspections.parseDisclosure(categoryChanged ? category : text(old.get("category")), body.get("inspection"))
                : null;
        // 只提交 inspection 时没有任何商品列需要更新；此时若仍调用 updateProductFields，
        // MyBatis 会生成空的 SET 子句（UPDATE products WHERE ...），直接 SQL 语法错误
        // 教材版本：
        //  * 显式提交 textbookEditionId → 按本次生效的分类与校区校验后关联 / 换绑；null 表示解除关联；
        //  * 切换到非教材分类 → 自动解除关联（不保留一个指向教材版本的数码产品）；
        //  * 换到其他学校的校区 → 自动解除关联（目录按学校划分）；
        //  * 否则保留原关联与快照。已生成订单的验货快照与这里无关。
        String effectiveCategory = category != null ? category : text(old.get("category"));
        String effectiveCampus = campus != null ? campus : text(old.get("campus"));
        Map<String, Object> linked = statusSet ? null : catalog.selectProductTextbook(pid);
        Map<String, Object> newEdition = null;
        boolean unlink = false;
        if (!statusSet && body.containsKey("textbookEditionId")) {
            newEdition = resolveTextbook(body.get("textbookEditionId"), effectiveCategory, effectiveCampus);
            unlink = newEdition == null && linked != null;
        } else if (linked != null && (!TEXTBOOK_CATEGORY.equals(effectiveCategory)
                || !text(linked.get("school_id")).equals(references.selectCampusSchool(effectiveCampus)))) {
            unlink = true;
        }
        // 先解除再改商品列：V6 触发器不允许「已关联教材的商品」被改成其他分类或其他学校
        if (unlink) catalog.unlinkProductTextbook(pid);
        // 模块 6：可见范围。显式提交 visibility / circleIds 时按本次生效的校区整体校验并替换；
        // 圈子商品换到别的校区时，原有圈子也要按新校区重新校验（跨校一律拒绝）。
        com.lulu.campusmarketbackend.circle.ProductVisibility.Choice choice = null;
        String currentVisibility = old.get("visibility") == null ? "PUBLIC" : text(old.get("visibility"));
        if (!statusSet && (body.containsKey("visibility") || body.containsKey("circleIds"))) {
            Object rawVisibility = body.containsKey("visibility") ? body.get("visibility") : currentVisibility;
            Object rawCircles = body.containsKey("circleIds") ? body.get("circleIds")
                    : ("CIRCLE_ONLY".equals(String.valueOf(rawVisibility)) && "CIRCLE_ONLY".equals(currentVisibility)
                        ? visibility.linkedCircles(pid).stream().map(UUID::toString).toList() : null);
            choice = com.lulu.campusmarketbackend.circle.ProductVisibility.parse(rawVisibility, rawCircles);
        } else if (!statusSet && campus != null && "CIRCLE_ONLY".equals(currentVisibility)) {
            choice = com.lulu.campusmarketbackend.circle.ProductVisibility.parse(currentVisibility,
                    visibility.linkedCircles(pid).stream().map(UUID::toString).toList());
        }
        if (choice != null) {
            visibility.requirePublishable(uuid(uid), effectiveCampus, choice);
            ProductEntity v = new ProductEntity(); v.setId(pid); v.setVisibility(choice.visibility()); products.updateById(v);
            visibility.replaceLinks(pid, choice);
        }
        boolean columnsChanged = statusSet || body.keySet().stream()
                .anyMatch(key -> !Set.of("inspection", "textbookEditionId", "bundleItems", "listingKind", "visibility", "circleIds").contains(key));
        if (columnsChanged) products.updateProductFields(pid, title, body.containsKey("title"), description, body.containsKey("description"), price, body.containsKey("price"), originalPrice, body.containsKey("originalPrice"), category, body.containsKey("category"), condition, body.containsKey("condition"), campus, body.containsKey("campus"), images, body.containsKey("images"), contact, body.containsKey("contact"), status, statusSet, buildingId, body.containsKey("buildingId"), statusSet && "已售出".equals(status) ? java.sql.Timestamp.from(Instant.now()) : null);
        if (replaceDisclosure) inspections.replaceDisclosure(pid, disclosure);
        // 后关联：商品分类已经是教材书籍之后才写关联（触发器按商品当前分类校验）
        if (newEdition != null) linkTextbook(pid, newEdition);
        if (bundleItems != null) bundles.replace(pid, bundleItems);
        // 标题、描述、价格、分类、校区、楼栋、上下架、教材版本都可能改变匹配结果：统一重新评估
        if (statusSet || !body.isEmpty()) demandMatches.evaluate(pid);
        return mapper.product(products.selectRowForViewer(pid, uuid(uid)), true);
    }


    /**
     * 模块 4：校验卖家选择的教材版本。null / 空串表示「不关联教材目录」。
     *
     * <p>只接受目录中已有版本的 id——服务端不根据书名、ISBN 相似度替卖家挑版本；
     * 前端按 ISBN 查到版本、由卖家主动确认后才会提交这个 id。
     * 教材目录按学校划分：学校由商品<b>所在校区</b>推导，其他学校的版本一律 404。
     */
    private Map<String, Object> resolveTextbook(Object raw, String category, String campus) {
        if (raw == null || (raw instanceof String blank && blank.isBlank())) return null;
        if (!(raw instanceof String editionId)) throw ApiException.badRequest("textbookEditionId 格式无效");
        if (!TEXTBOOK_CATEGORY.equals(category)) throw ApiException.badRequest("只有教材书籍分类的商品可以关联教材版本");
        String school = references.selectCampusSchool(campus);
        if (school == null) throw ApiException.badRequest("校区无效");
        return catalogService.requireEdition(school, editionId.trim());
    }

    /** 关联并保存展示快照；版本不变时不改写快照（SQL 的 ON CONFLICT … WHERE 保证）。 */
    private void linkTextbook(UUID productId, Map<String, Object> edition) {
        catalog.linkProductTextbook(productId, text(edition.get("school_id")), text(edition.get("id")),
                nullableText(edition.get("normalized_isbn")), text(edition.get("title")),
                text(edition.get("edition_label")), text(edition.get("publisher")));
    }

    /**
     * 解析商品更新中的取货楼栋。
     *
     * <p>校区与楼栋必须始终自洽，所以这里有两条规则：
     * <ul>
     *   <li>显式给了 {@code buildingId}：按<b>本次生效</b>的校区校验（同时改校区时用新校区）。
     *       传 null 或空串表示「不指定楼栋」，是合法选择。</li>
     *   <li>只改校区、没给 {@code buildingId}：如果原楼栋不属于新校区，
     *       <b>返回 400</b> 而不是悄悄清空。悄悄清空会让买家在商品页上看到的取货点
     *       无声消失；更糟的是若换成静默保留，买家会走到另一个校区去。
     *       这里要求卖家显式表态，语义固定并有测试覆盖。</li>
     * </ul>
     */
    private String resolveProductBuilding(Map<String, Object> body, Map<String, Object> old, String newCampus) {
        String effectiveCampus = newCampus != null ? newCampus : text(old.get("campus"));
        if (body.containsKey("buildingId")) {
            Object raw = body.get("buildingId");
            if (raw == null || String.valueOf(raw).isBlank()) return null;
            return buildings.requireSelectable(String.valueOf(raw), effectiveCampus);
        }
        if (newCampus != null) {
            String current = DomainMapper.nullableText(old.get("building_id"));
            if (current != null && !current.isBlank()) {
                Map<String, Object> row = buildings.rowById(current);
                if (row == null || !effectiveCampus.equals(text(row.get("campus_id")))) {
                    throw ApiException.badRequest(
                            "切换校区后原取货楼栋不再属于该校区，请同时提供 buildingId（传 null 表示不指定楼栋）");
                }
            }
        }
        return null;
    }

    public List<Map<String, Object>> favorites(String uid) { return favorites.selectRowsByUser(uuid(uid)).stream().map(mapper::favorite).toList(); }

    /**
     * 幂等新增收藏：重复调用结果一致，始终返回已收藏。
     * 身份只取自认证 uid，路径中的 productId 只代表资源，不参与身份判定。
     */
    @Transactional
    public Map<String, Object> favorite(String uid, String id) {
        product(id, uid); UUID userId = uuid(uid), productId = uuid(id);
        favorites.insertIfAbsent(UUID.randomUUID(), userId, productId);
        return map("active", true);
    }

    /**
     * 幂等取消收藏：删除 0 行也视为目标状态（未收藏）已满足，重复调用结果一致。
     */
    @Transactional
    public Map<String, Object> unfavorite(String uid, String id) {
        product(id, uid); UUID userId = uuid(uid), productId = uuid(id);
        favorites.deleteByUserAndProduct(userId, productId);
        return map("active", false);
    }

    public List<Map<String, Object>> comments(String id, String uid) { product(id, uid); return comments.selectRowsByProduct(uuid(id)).stream().map(row -> mapper.comment(row, uid)).toList(); }

    public Map<String, Object> comment(String uid, String id, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, COMMENT_FIELDS); product(id, uid); String content = AuthService.string(body, "content", 1, 2000); UUID parentId = body.get("parentId") == null ? null : uuid(String.valueOf(body.get("parentId"))); if (parentId != null && comments.countRootByIdAndProduct(parentId, uuid(id)) == 0) throw ApiException.badRequest("回复对象无效");
        CommentEntity entity = new CommentEntity(); entity.setId(UUID.randomUUID()); entity.setProductId(uuid(id)); entity.setUserId(uuid(uid)); entity.setContent(content); entity.setParentId(parentId); comments.insert(entity); return mapper.comment(commentRow(entity.getId()), uid);
    }

    public List<Map<String, Object>> conversations(String uid) { return conversations.selectRowsByUser(uuid(uid)).stream().map(mapper::conversation).toList(); }

    @Transactional
    public Map<String, Object> conversation(String uid, String productId) {
        Map<String, Object> p = product(productId, uid); if (uid.equals(text(p.get("sellerId")))) throw ApiException.badRequest("不能咨询自己的商品"); UUID id = UUID.randomUUID(); conversations.insertOrReuse(id, uuid(productId), uuid(uid), uuid(text(p.get("sellerId")))); return mapper.conversation(conversations.selectRowByProductAndBuyer(uuid(productId), uuid(uid)));
    }

    public List<Map<String, Object>> messages(String uid, String id) { member(uid, id); return messages.selectRowsByConversation(uuid(id)).stream().map(mapper::message).toList(); }

    @Transactional
    public Map<String, Object> message(String uid, String id, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, MESSAGE_FIELDS); String content = AuthService.string(body, "content", 1, 2000); member(uid, id); MessageEntity entity = new MessageEntity(); entity.setId(UUID.randomUUID()); entity.setConversationId(uuid(id)); entity.setSenderId(uuid(uid)); entity.setContent(content); messages.insert(entity); conversations.touch(uuid(id)); return mapper.message(messageRow(entity.getId()));
    }

    @Transactional public void read(String uid, String id) { member(uid, id); reads.markRead(uuid(id), uuid(uid)); }
    public Map<String, Object> unread(String uid) { return map("count", messages.countUnread(uuid(uid))); }

    private Map<String, Object> commentRow(UUID id) { return comments.selectById(id) == null ? null : map("id", id, "product_id", comments.selectById(id).getProductId(), "user_id", comments.selectById(id).getUserId(), "content", comments.selectById(id).getContent(), "parent_id", comments.selectById(id).getParentId(), "created_at", comments.selectById(id).getCreatedAt()); }
    private Map<String, Object> messageRow(UUID id) { MessageEntity e = messages.selectById(id); return map("id", id, "conversation_id", e.getConversationId(), "sender_id", e.getSenderId(), "content", e.getContent(), "created_at", e.getCreatedAt()); }
    // 模块 6：无权访问（包括商品已不可读）与会话不存在一样返回 404，不形成侧信道
    private void member(String uid, String cid) { if (conversations.countMember(uuid(cid), uuid(uid)) == 0) throw ApiException.notFound("会话不存在"); }
    private ProductInput productInput(Map<String, Object> body, String sellerSchool) {
        JsonFieldPolicy.rejectUnknown(body, PRODUCT_FIELDS);
        String campus = schools.requireCampusInSchool(body.get("campus"), sellerSchool);
        Object rawBuilding = body.get("buildingId");
        // 不指定楼栋是合法选择：公共地点交易、或卖家不愿公开楼栋
        String buildingId = rawBuilding == null || String.valueOf(rawBuilding).isBlank()
                ? null
                : buildings.requireSelectable(String.valueOf(rawBuilding), campus);
        return new ProductInput(AuthService.string(body, "title", 1, 100), AuthService.string(body, "description", 1, 4000), price(body.get("price")), body.get("originalPrice") == null ? null : price(body.get("originalPrice")), enumValue(body.get("category"), CATEGORIES, "分类"), enumValue(body.get("condition"), CONDITIONS, "成色"), campus, buildingId, images(body.get("images")), AuthService.optional(body, "contact", 100));
    }
    public static String listingKind(Object raw) {
        if (raw == null) return "SINGLE";
        String value = String.valueOf(raw);
        if (!LISTING_KINDS.contains(value)) throw ApiException.badRequest("发布方式无效");
        return value;
    }
    public static List<String> images(Object raw) { if (!(raw instanceof List<?> values) || values.size() > 9) throw ApiException.badRequest("图片格式无效"); List<String> result = new ArrayList<>(); for (Object value : values) { if (!(value instanceof String s) || s.length() > 2048 || !s.matches("^https?://.*")) throw ApiException.badRequest("图片必须使用 HTTP(S) 地址"); result.add(s); } return result; }
    public static BigDecimal price(Object raw) { if (!(raw instanceof Number) && !(raw instanceof String)) throw ApiException.badRequest("价格无效"); try { BigDecimal value = new BigDecimal(String.valueOf(raw)); if (value.signum() < 0 || value.compareTo(new BigDecimal("99999999")) > 0 || value.scale() > 2) throw new Exception(); return value; } catch (Exception e) { throw ApiException.badRequest("价格最多两位小数"); } }
    public static String enumValue(Object raw, List<String> allowed, String label) { String value = raw == null ? "" : String.valueOf(raw); if (!allowed.contains(value)) throw ApiException.badRequest(label + "无效"); return value; }
    private static UUID uuid(Object value) { try { return UUID.fromString(String.valueOf(value)); } catch (Exception e) { throw ApiException.badRequest("ID 格式无效"); } }
    private static String trim(String value) { return value == null ? "" : value.trim(); }
    private static BigDecimal decimalQuery(String value, String name) { if (value == null || value.isBlank()) return null; try { BigDecimal d = new BigDecimal(value); if (d.signum() < 0) throw new Exception(); return d; } catch (Exception e) { throw ApiException.badRequest(name + " 无效"); } }
    private static int integerQuery(String value, String name, int min, int max, int fallback) { if (value == null || value.isBlank()) return fallback; try { int n = Integer.parseInt(value); if (n < min || n > max) throw new Exception(); return n; } catch (Exception e) { throw ApiException.badRequest(name + " 无效"); } }
    private record ProductInput(String title, String description, BigDecimal price, BigDecimal originalPrice, String category, String condition, String campus, String buildingId, List<String> images, String contact) {}
}
