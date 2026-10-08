package com.lulu.campusmarketbackend.circle;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.building.BuildingFeedService;
import com.lulu.campusmarketbackend.building.BuildingScope;
import com.lulu.campusmarketbackend.mapper.CircleMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 模块 6：圈子集市的圈子与成员管理。
 *
 * <p>权限矩阵（无权访问与不存在一律 404，不区分「他校」「私密」「不存在」）：
 * <ul>
 *   <li>任何本校用户：创建圈子；浏览 DISCOVERABLE 圈子的名称 / 简介 / 「用户创建」标识；用邀请码加入。</li>
 *   <li>MEMBER：查看圈子资料与圈子商品流；退出。不能看完整成员名单，不能管理成员。</li>
 *   <li>MODERATOR：额外可以发邀请、撤销邀请、查看成员名单（最小公共投影）、移除 MEMBER、修改名称与简介。</li>
 *   <li>OWNER：额外可以调整角色、转让所有者、移除 MODERATOR、修改可见范围、归档。不能直接退出。</li>
 * </ul>
 *
 * <p>并发：所有成员变化、归档、改资料都先对圈子行加 FOR UPDATE，同一圈子串行；
 * 部分唯一索引保证至多一个在籍 OWNER，提交时的约束触发器保证恰好一个。不使用任何内存锁。
 */
@Service
public class CircleService {

    public static final Set<String> TYPES = Set.of("CLASS", "CLUB", "INTEREST", "OTHER");
    public static final Set<String> VISIBILITIES = Set.of("PRIVATE", "DISCOVERABLE");
    public static final int DEFAULT_INVITE_HOURS = 24;
    public static final int MAX_INVITE_HOURS = 7 * 24;
    private static final Set<String> CREATE_FIELDS = Set.of("type", "name", "description", "visibility");
    private static final Set<String> PATCH_FIELDS = Set.of("type", "name", "description", "visibility");
    private static final Set<String> INVITE_FIELDS = Set.of("expiresInHours");
    private static final Set<String> REDEEM_FIELDS = Set.of("token");
    private static final Set<String> MEMBER_PATCH_FIELDS = Set.of("role");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final CircleMapper circles;
    private final RateLimitService rateLimit;
    private final BuildingFeedService feeds;

    private final com.lulu.campusmarketbackend.governance.RestrictionGuard restrictions;

    public CircleService(CircleMapper circles, RateLimitService rateLimit, BuildingFeedService feeds,
                         com.lulu.campusmarketbackend.governance.RestrictionGuard restrictions) {
        this.restrictions = restrictions;
        this.circles = circles;
        this.rateLimit = rateLimit;
        this.feeds = feeds;
    }

    // ================= 圈子 =================

    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, CREATE_FIELDS);
        UUID me = UUID.fromString(uid);
        // 模块 7：只禁止新建圈子；已有圈子的管理与退出不受影响
        restrictions.require(me, "CIRCLE_CREATION");
        String school = school(me);
        String type = enumValue(body.get("type"), TYPES, "圈子类型");
        String name = name(body.get("name"));
        String description = description(body.get("description"));
        String visibility = body.get("visibility") == null ? "PRIVATE" : enumValue(body.get("visibility"), VISIBILITIES, "可见范围");
        rateLimit.consume(RateLimitService.Scope.CIRCLE_CREATE, uid);
        UUID id = UUID.randomUUID();
        circles.insertCircle(id, school, type, name, description, visibility, me);
        circles.joinCircle(id, me, school, "OWNER");
        circles.insertEvent(id, me, me, "CIRCLE_CREATED", null);
        return view(circles.selectCircle(id), "OWNER");
    }

    public List<Map<String, Object>> mine(String uid) {
        return circles.selectMyCircles(UUID.fromString(uid)).stream().map(row -> view(row, DomainMapper.text(row.get("role")))).toList();
    }

    public List<Map<String, Object>> discover(String uid, String q) {
        UUID me = UUID.fromString(uid);
        String query = q == null || q.isBlank() ? null : q.strip().toLowerCase(java.util.Locale.ROOT);
        if (query != null && query.length() > 30) throw ApiException.badRequest("搜索词最多 30 个字");
        return circles.selectDiscoverable(school(me), me, query, 50).stream().map(row -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", DomainMapper.text(row.get("id")));
            item.put("type", DomainMapper.text(row.get("type")));
            item.put("name", DomainMapper.text(row.get("name")));
            item.put("description", DomainMapper.text(row.get("description")));
            item.put("userCreated", true);
            item.put("joined", Boolean.TRUE.equals(row.get("joined")));
            return item;
        }).toList();
    }

    /** 成员看到完整资料与自己的角色；非成员只在 DISCOVERABLE 且在用时看到名称 / 简介 / 类型；其余 404。 */
    public Map<String, Object> get(String uid, String id) {
        UUID me = UUID.fromString(uid);
        Map<String, Object> circle = visibleCircle(parse(id), me);
        Map<String, Object> membership = activeMembership(parse(id), me);
        if (membership != null) return view(circle, DomainMapper.text(membership.get("role")));
        Map<String, Object> limited = new LinkedHashMap<>();
        limited.put("id", DomainMapper.text(circle.get("id")));
        limited.put("type", DomainMapper.text(circle.get("type")));
        limited.put("name", DomainMapper.text(circle.get("name")));
        limited.put("description", DomainMapper.text(circle.get("description")));
        limited.put("userCreated", true);
        limited.put("joined", false);
        return limited;
    }

    @Transactional
    public Map<String, Object> update(String uid, String id, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, PATCH_FIELDS);
        UUID me = UUID.fromString(uid);
        UUID circleId = parse(id);
        Map<String, Object> circle = lockVisible(circleId, me);
        String role = requireManager(circleId, me);
        requireActive(circle);
        if ((body.containsKey("visibility") || body.containsKey("type")) && !"OWNER".equals(role)) {
            throw ApiException.forbidden("只有所有者可以修改圈子的类型与可见范围");
        }
        String type = body.containsKey("type") ? enumValue(body.get("type"), TYPES, "圈子类型") : DomainMapper.text(circle.get("type"));
        String name = body.containsKey("name") ? name(body.get("name")) : DomainMapper.text(circle.get("name"));
        String description = body.containsKey("description") ? description(body.get("description")) : DomainMapper.text(circle.get("description"));
        String visibility = body.containsKey("visibility") ? enumValue(body.get("visibility"), VISIBILITIES, "可见范围") : DomainMapper.text(circle.get("visibility"));
        circles.updateCircle(circleId, type, name, description, visibility);
        circles.insertEvent(circleId, me, null, "CIRCLE_UPDATED", null);
        return view(circles.selectCircle(circleId), role);
    }

    /**
     * 归档（只有所有者，不可撤销）：圈子商品对成员不再可见（仍有效或已完成订单的参与者照常完成交易），
     * 全部圈子订阅停用、匹配失效，未兑换的邀请全部撤销。成员关系保留作为历史。
     */
    @Transactional
    public Map<String, Object> archive(String uid, String id) {
        UUID me = UUID.fromString(uid);
        UUID circleId = parse(id);
        Map<String, Object> circle = lockVisible(circleId, me);
        if (!"OWNER".equals(requireManager(circleId, me))) throw ApiException.forbidden("只有所有者可以归档圈子");
        if ("ACTIVE".equals(circle.get("status"))) {
            circles.archiveCircle(circleId);
            circles.revokePendingInvites(circleId);
            circles.invalidateCircleMatches(circleId);
            circles.deactivateCircleSubscriptions(circleId);
            circles.insertEvent(circleId, me, null, "CIRCLE_ARCHIVED", null);
        }
        return view(circles.selectCircle(circleId), "OWNER");
    }

    /**
     * 模块 7：平台工作人员强制归档（治理动作 ARCHIVE_CIRCLE）。与所有者归档走同一套清理，同样先锁圈子行：
     * 与所有者的并发归档在行锁上串行化，只会产生一次 CIRCLE_ARCHIVED。返回这次调用是否真的归档了圈子。
     */
    public boolean archiveAsStaff(UUID circleId, UUID staff) {
        Map<String, Object> circle = circles.lockCircle(circleId);
        if (circle == null || !"ACTIVE".equals(circle.get("status"))) return false;
        circles.archiveCircle(circleId);
        circles.revokePendingInvites(circleId);
        circles.invalidateCircleMatches(circleId);
        circles.deactivateCircleSubscriptions(circleId);
        circles.insertEvent(circleId, staff, null, "CIRCLE_ARCHIVED", null);
        return true;
    }

    /** 圈子商品流：只有在籍成员可以看；商品仍然经过同一套可见性函数过滤。 */
    public Map<String, Object> products(String uid, String id, Map<String, String> query) {
        UUID me = UUID.fromString(uid);
        UUID circleId = parse(id);
        visibleCircle(circleId, me);
        if (activeMembership(circleId, me) == null) throw ApiException.notFound("圈子不存在");
        int page = intParam(query.get("page"), 1, 10000, 1);
        int pageSize = intParam(query.get("pageSize"), 1, 100, 20);
        return feeds.feed(new BuildingFeedService.FeedQuery(null, null, null, null, null, BuildingScope.SCHOOL,
                "p.created_at DESC", page, pageSize, null, false, circleId), uid);
    }

    // ================= 邀请 =================

    @Transactional
    public Map<String, Object> createInvite(String uid, String id, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, INVITE_FIELDS);
        UUID me = UUID.fromString(uid);
        UUID circleId = parse(id);
        Map<String, Object> circle = lockVisible(circleId, me);
        requireManager(circleId, me);
        requireActive(circle);
        int hours = DEFAULT_INVITE_HOURS;
        if (body.get("expiresInHours") != null) {
            if (!(body.get("expiresInHours") instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue())
                    || n.intValue() < 1 || n.intValue() > MAX_INVITE_HOURS) {
                throw ApiException.badRequest("有效期应为 1～168 小时");
            }
            hours = n.intValue();
        }
        rateLimit.consume(RateLimitService.Scope.CIRCLE_INVITE_CREATE, uid);
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        UUID inviteId = UUID.randomUUID();
        circles.insertInvite(inviteId, circleId, me, sha256(token), hours);
        circles.insertEvent(circleId, me, null, "INVITE_CREATED", null);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("invite", inviteView(circles.selectInvite(inviteId)));
        // 原始邀请码只出现这一次；服务端只有它的哈希
        result.put("token", token);
        return result;
    }

    public List<Map<String, Object>> invites(String uid, String id) {
        UUID me = UUID.fromString(uid);
        UUID circleId = parse(id);
        visibleCircle(circleId, me);
        requireManager(circleId, me);
        return circles.selectInvites(circleId).stream().map(CircleService::inviteView).toList();
    }

    @Transactional
    public Map<String, Object> revokeInvite(String uid, String inviteId) {
        UUID me = UUID.fromString(uid);
        Map<String, Object> invite = circles.selectInvite(parse(inviteId));
        if (invite == null) throw ApiException.notFound("邀请不存在");
        UUID circleId = (UUID) invite.get("circle_id");
        lockVisible(circleId, me);
        Map<String, Object> membership = activeMembership(circleId, me);
        if (membership == null || "MEMBER".equals(membership.get("role"))) throw ApiException.notFound("邀请不存在");
        if (circles.revokeInvite((UUID) invite.get("id")) > 0) circles.insertEvent(circleId, me, null, "INVITE_REVOKED", null);
        return inviteView(circles.selectInvite((UUID) invite.get("id")));
    }

    /**
     * 兑换邀请：每次尝试都先计入限流；不存在、已使用、已撤销、已过期、他校、圈子已归档、本来就是成员，
     * 对外都是同一个 404「邀请码无效或已失效」，不透露邀请码或圈子是否存在。
     */
    @Transactional
    public Map<String, Object> redeem(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, REDEEM_FIELDS);
        rateLimit.consume(RateLimitService.Scope.CIRCLE_INVITE_REDEEM, uid);
        UUID me = UUID.fromString(uid);
        Object raw = body.get("token");
        if (!(raw instanceof String token) || token.isBlank() || token.length() > 200) throw invalidInvite();
        Map<String, Object> invite = circles.lockInviteByHash(sha256(token.trim()));
        if (invite == null) throw invalidInvite();
        // 7.1D 邀请的有效性规则（固定契约）：
        //   · 可用 = PENDING 且未过期；
        //   · 原兑换者重放 = REDEEMED 且兑换人就是本人（例如网络重试、双击）；
        //   · 其余（不存在、过期、撤销、被他人兑换、他校、圈子已归档）一律同一个 404。
        // 只有邀请本身满足规则之后，才考虑「已在籍 → 幂等 200」；随机码不会因为用户在某个圈子里而得到 200。
        String status = DomainMapper.text(invite.get("status"));
        boolean usable = "PENDING".equals(status) && Boolean.TRUE.equals(invite.get("unexpired"));
        boolean replay = "REDEEMED".equals(status) && me.equals(invite.get("redeemed_by"));
        if (!usable && !replay) throw invalidInvite();
        UUID circleId = (UUID) invite.get("circle_id");
        Map<String, Object> circle = circles.lockCircle(circleId);
        String school = school(me);
        if (circle == null || !"ACTIVE".equals(circle.get("status")) || !school.equals(circle.get("school_id"))) throw invalidInvite();
        // 6.1C：邀请有效且本人已在该圈在籍 → 幂等返回圈子，不消耗邀请码，也不占名额
        Map<String, Object> existing = activeMembership(circleId, me);
        if (existing != null) return view(circle, DomainMapper.text(existing.get("role")));
        // 原兑换者已退出 / 被移除：这个码已经用过，不能用来重新加入
        if (!usable) throw invalidInvite();
        // 在籍人数上限（含 OWNER；LEFT / REMOVED 不占名额）：圈子行已锁，并发兑换在这里串行化。
        // 名额已满时邀请码不被消耗，V10 的 circle_member_cap_guard 触发器兜底
        if (circles.countActiveMembers(circleId) >= MEMBER_LIMIT) throw ApiException.conflict("圈子人数已达上限（" + MEMBER_LIMIT + " 人）");
        if (circles.redeemInvite((UUID) invite.get("id"), me) == 0) throw invalidInvite();
        circles.joinCircle(circleId, me, school, "MEMBER");
        circles.insertEvent(circleId, me, me, "MEMBER_JOINED", "MEMBER");
        return view(circles.selectCircle(circleId), "MEMBER");
    }

    // ================= 成员 =================

    /** 6.1C：单圈在籍成员上限（含 OWNER）。 */
    public static final int MEMBER_LIMIT = 1000;

    /** 成员名单只给 OWNER / MODERATOR，并且只有管理所需的最小公共投影。6.1C：分页，默认 20、最大 100。 */
    public Map<String, Object> members(String uid, String id, String rawPage, String rawSize) {
        int page = pageParam(rawPage, "page", 1, 10000, 1);
        int size = pageParam(rawSize, "size", 1, 100, 20);
        UUID me = UUID.fromString(uid);
        UUID circleId = parse(id);
        visibleCircle(circleId, me);
        requireManager(circleId, me);
        List<Map<String, Object>> items = circles.selectMembers(circleId, size, (page - 1) * size).stream().map(row -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("userId", DomainMapper.text(row.get("user_id")));
            m.put("nickname", DomainMapper.text(row.get("nickname")));
            m.put("avatar", DomainMapper.text(row.get("avatar")));
            m.put("role", DomainMapper.text(row.get("role")));
            m.put("joinedAt", DomainMapper.epoch(row.get("joined_at")));
            return m;
        }).toList();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", circles.countActiveMembers(circleId));
        result.put("page", page);
        result.put("size", size);
        return result;
    }

    private static int pageParam(String raw, String name, int min, int max, int fallback) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            int n = Integer.parseInt(raw.trim());
            if (n < min || n > max) throw new NumberFormatException();
            return n;
        } catch (NumberFormatException e) {
            throw ApiException.badRequest(name + " 无效");
        }
    }

    /**
     * 调整角色（只有 OWNER）：MEMBER ⇄ MODERATOR；把某位成员设为 OWNER 即转让，原所有者变为 MODERATOR。
     */
    @Transactional
    public Map<String, Object> changeRole(String uid, String id, String targetId, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, MEMBER_PATCH_FIELDS);
        UUID me = UUID.fromString(uid);
        UUID circleId = parse(id);
        UUID target = parse(targetId);
        Map<String, Object> circle = lockVisible(circleId, me);
        requireActive(circle);
        if (!"OWNER".equals(requireManager(circleId, me))) throw ApiException.forbidden("只有所有者可以调整成员角色");
        String role = enumValue(body.get("role"), Set.of("OWNER", "MODERATOR", "MEMBER"), "角色");
        Map<String, Object> targetMembership = activeMembership(circleId, target);
        if (targetMembership == null) throw ApiException.notFound("成员不存在");
        if (target.equals(me)) throw ApiException.badRequest("所有者不能修改自己的角色；需要时请把所有者转让给其他成员");
        if ("OWNER".equals(role)) {
            // 转让：先把自己降为 MODERATOR，再提升对方；部分唯一索引不会在中间状态出现两个 OWNER
            circles.setRole(circleId, me, "MODERATOR");
            circles.setRole(circleId, target, "OWNER");
            circles.setCircleOwner(circleId, target);
            circles.insertEvent(circleId, me, target, "OWNER_TRANSFERRED", "OWNER");
        } else if (!role.equals(targetMembership.get("role"))) {
            circles.setRole(circleId, target, role);
            circles.insertEvent(circleId, me, target, "ROLE_CHANGED", role);
        }
        return members(uid, id, null, null);
    }

    /**
     * 退出（自己）或移除（他人）。OWNER 不能直接退出；MODERATOR 只能移除 MEMBER；MEMBER 只能退出自己。
     * 离开后：他在这个圈子的订阅停用、匹配失效（未读清零），圈子商品立即不可见；已经成立的订单不受影响。
     */
    @Transactional
    public Map<String, Object> removeMember(String uid, String id, String targetId) {
        UUID me = UUID.fromString(uid);
        UUID circleId = parse(id);
        UUID target = parse(targetId);
        lockVisible(circleId, me);
        Map<String, Object> mine = activeMembership(circleId, me);
        if (mine == null) throw ApiException.notFound("圈子不存在");
        Map<String, Object> theirs = activeMembership(circleId, target);
        if (theirs == null) throw ApiException.notFound("成员不存在");
        String myRole = DomainMapper.text(mine.get("role"));
        String theirRole = DomainMapper.text(theirs.get("role"));
        boolean self = me.equals(target);
        if (self && "OWNER".equals(myRole)) throw ApiException.conflict("所有者不能直接退出，请先把所有者转让给其他成员，或归档圈子");
        if (!self) {
            if ("MEMBER".equals(myRole)) throw ApiException.forbidden("普通成员不能管理其他成员");
            if ("OWNER".equals(theirRole)) throw ApiException.forbidden("不能移除圈子所有者");
            if ("MODERATOR".equals(myRole) && !"MEMBER".equals(theirRole)) throw ApiException.forbidden("管理员只能移除普通成员");
        }
        circles.endMembership(circleId, target, self ? "LEFT" : "REMOVED");
        circles.invalidateMemberMatches(circleId, target);
        circles.deactivateMemberSubscriptions(circleId, target);
        circles.insertEvent(circleId, me, target, self ? "MEMBER_LEFT" : "MEMBER_REMOVED", null);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("userId", target.toString());
        result.put("status", self ? "LEFT" : "REMOVED");
        return result;
    }

    // ================= 内部 =================

    /** 圈子对这个人「存在」：本校，且（在籍成员，或 DISCOVERABLE 且在用）。否则 404。 */
    private Map<String, Object> visibleCircle(UUID circleId, UUID me) {
        Map<String, Object> circle = circles.selectCircle(circleId);
        if (circle == null || !school(me).equals(circle.get("school_id"))) throw ApiException.notFound("圈子不存在");
        if (activeMembership(circleId, me) != null) return circle;
        if ("ACTIVE".equals(circle.get("status")) && "DISCOVERABLE".equals(circle.get("visibility"))) return circle;
        throw ApiException.notFound("圈子不存在");
    }

    private Map<String, Object> lockVisible(UUID circleId, UUID me) {
        visibleCircle(circleId, me);
        return circles.lockCircle(circleId);
    }

    private Map<String, Object> activeMembership(UUID circleId, UUID userId) {
        Map<String, Object> m = circles.selectMembership(circleId, userId);
        return m != null && "ACTIVE".equals(m.get("status")) ? m : null;
    }

    /** OWNER / MODERATOR 返回角色；普通成员 403（他们已知道圈子存在）；非成员 404。 */
    private String requireManager(UUID circleId, UUID me) {
        Map<String, Object> m = activeMembership(circleId, me);
        if (m == null) throw ApiException.notFound("圈子不存在");
        String role = DomainMapper.text(m.get("role"));
        if ("MEMBER".equals(role)) throw ApiException.forbidden("只有圈子的所有者或管理员可以进行这个操作");
        return role;
    }

    private static void requireActive(Map<String, Object> circle) {
        if (!"ACTIVE".equals(circle.get("status"))) throw ApiException.conflict("圈子已归档");
    }

    private String school(UUID userId) {
        String school = circles.selectUserSchool(userId);
        if (school == null) throw ApiException.unauthorized("登录已失效，请重新登录");
        return school;
    }

    static Map<String, Object> view(Map<String, Object> row, String role) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("type", DomainMapper.text(row.get("type")));
        result.put("name", DomainMapper.text(row.get("name")));
        result.put("description", DomainMapper.text(row.get("description")));
        result.put("visibility", DomainMapper.text(row.get("visibility")));
        result.put("status", DomainMapper.text(row.get("status")));
        // 固定标识：所有圈子都是用户创建的，不存在「学校官方认证」的圈子
        result.put("userCreated", true);
        result.put("joined", true);
        result.put("myRole", role);
        result.put("createdAt", DomainMapper.epoch(row.get("created_at")));
        return result;
    }

    private static Map<String, Object> inviteView(Map<String, Object> row) {
        String status = DomainMapper.text(row.get("status"));
        boolean expired = "PENDING".equals(status) && DomainMapper.epoch(row.get("expires_at")) <= System.currentTimeMillis();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("status", expired ? "EXPIRED" : status);
        result.put("expiresAt", DomainMapper.epoch(row.get("expires_at")));
        result.put("createdAt", DomainMapper.epoch(row.get("created_at")));
        return result;
    }

    private static ApiException invalidInvite() {
        return ApiException.notFound("邀请码无效或已失效");
    }

    private static String name(Object raw) {
        if (!(raw instanceof String s)) throw ApiException.badRequest("请填写圈子名称");
        String value = s.strip().replaceAll("(?U)\\s+", " ");
        if (value.length() < 2 || value.length() > 30) throw ApiException.badRequest("圈子名称应为 2～30 个字");
        if (value.indexOf('<') >= 0 || value.indexOf('>') >= 0) throw ApiException.badRequest("圈子名称不能包含尖括号");
        return value;
    }

    private static String description(Object raw) {
        if (raw == null) return "";
        if (!(raw instanceof String s)) throw ApiException.badRequest("简介格式无效");
        String value = s.strip();
        if (value.length() > 200) throw ApiException.badRequest("简介最多 200 个字");
        if (value.indexOf('<') >= 0 || value.indexOf('>') >= 0) throw ApiException.badRequest("简介不能包含尖括号");
        return value;
    }

    private static String enumValue(Object raw, Set<String> allowed, String label) {
        String value = raw == null ? "" : String.valueOf(raw);
        if (!allowed.contains(value)) throw ApiException.badRequest(label + "无效");
        return value;
    }

    private static int intParam(String raw, int min, int max, int fallback) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            int n = Integer.parseInt(raw);
            if (n < min || n > max) throw new NumberFormatException();
            return n;
        } catch (NumberFormatException e) {
            throw ApiException.badRequest("分页参数无效");
        }
    }

    static UUID parse(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw ApiException.notFound("圈子不存在");
        }
    }

    static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
