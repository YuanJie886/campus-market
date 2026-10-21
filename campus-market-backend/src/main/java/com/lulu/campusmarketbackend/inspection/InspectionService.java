package com.lulu.campusmarketbackend.inspection;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.InspectionMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 验货模板与商品声明（模块 3.2）。
 *
 * <ul>
 *   <li><b>模板</b>按分类、带版本，发布即冻结（数据库触发器保证）；</li>
 *   <li><b>商品声明</b>是卖家「当前」对每个条目的说法，可随编辑更新，展示在商品详情里供买家参考。</li>
 * </ul>
 * 站内交易已停用：订单验货快照只作为历史数据保留（V16 起只读），这里不再生成。
 */
@Service
public class InspectionService {

    /** 卖家声明的四种状态（机器码）。中文只在前端映射。 */
    public static final Set<String> CONDITIONS = Set.of("NORMAL", "DEFECT", "NOT_TESTED", "NOT_APPLICABLE");
    /** 声明条目允许的字段。productId / sellerId / templateVersion 等服务端字段一律拒绝。 */
    private static final Set<String> DISCLOSURE_ITEM_FIELDS = Set.of("itemCode", "condition", "note");
    public static final int MAX_NOTE_LENGTH = 200;

    private final InspectionMapper inspections;

    public InspectionService(InspectionMapper inspections) {
        this.inspections = inspections;
    }

    // ------------------------------------------------------------------
    // 模板
    // ------------------------------------------------------------------

    /**
     * 某分类的当前模板。不支持的分类返回 null（允许无清单发布）。
     * 只返回当前启用版本：客户端无法选择过期版本来绕过当前的必填要求。
     */
    public Map<String, Object> currentTemplate(String category) {
        Map<String, Object> template = inspections.selectActiveTemplate(category);
        if (template == null) return null;
        return projectTemplate(template, inspections.selectTemplateItems(DomainMapper.text(template.get("id"))));
    }

    private static Map<String, Object> projectTemplate(Map<String, Object> template, List<Map<String, Object>> items) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("category", DomainMapper.text(template.get("category")));
        result.put("version", ((Number) template.get("version")).intValue());
        result.put("title", DomainMapper.text(template.get("title")));
        List<Map<String, Object>> projected = new ArrayList<>();
        for (Map<String, Object> item : items) {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("code", DomainMapper.text(item.get("code")));
            p.put("label", DomainMapper.text(item.get("label")));
            p.put("description", DomainMapper.text(item.get("description")));
            p.put("required", Boolean.TRUE.equals(item.get("required")));
            projected.add(p);
        }
        result.put("items", projected);
        return result;
    }

    // ------------------------------------------------------------------
    // 商品声明
    // ------------------------------------------------------------------

    /** 校验通过的一份声明：绑定到具体的模板版本。 */
    public record Disclosure(String templateId, List<InspectionMapper.DisclosureRow> rows) {}

    /**
     * 校验并规范化卖家提交的声明。
     *
     * @param category 本次生效的分类
     * @param raw      请求体中的 inspection 字段；可能为 null
     * @return 支持的分类返回声明；不支持的分类返回 null
     */
    public Disclosure parseDisclosure(String category, Object raw) {
        Map<String, Object> template = inspections.selectActiveTemplate(category);
        if (template == null) return parseDisclosure((TemplateRef) null, raw);
        String templateId = DomainMapper.text(template.get("id"));
        Map<String, Boolean> requiredByCode = new LinkedHashMap<>();
        for (Map<String, Object> item : inspections.selectTemplateItems(templateId)) {
            requiredByCode.put(DomainMapper.text(item.get("code")), Boolean.TRUE.equals(item.get("required")));
        }
        return parseDisclosure(new TemplateRef(templateId, requiredByCode), raw);
    }

    /** 一个分类当前模板的「条目码 → 是否必填」。 */
    public record TemplateRef(String templateId, Map<String, Boolean> requiredByCode) {}

    /**
     * 全部启用模板，按分类索引（一条 SQL）。批量发布校验用它在内存里逐条检查，
     * 读取语句数与批次条数无关。
     */
    public Map<String, TemplateRef> activeTemplatesByCategory() {
        Map<String, TemplateRef> result = new LinkedHashMap<>();
        for (Map<String, Object> row : inspections.selectActiveTemplateItemsAll()) {
            String category = DomainMapper.text(row.get("category"));
            TemplateRef ref = result.computeIfAbsent(category,
                    k -> new TemplateRef(DomainMapper.text(row.get("template_id")), new LinkedHashMap<>()));
            ref.requiredByCode().put(DomainMapper.text(row.get("code")), Boolean.TRUE.equals(row.get("required")));
        }
        return result;
    }

    /** 纯校验：template 为 null 表示该分类没有清单。规则与上面的重载完全相同。 */
    public Disclosure parseDisclosure(TemplateRef templateRef, Object raw) {
        if (templateRef == null) {
            // 不支持的分类：允许无清单发布，但不接受一份不知道对应什么模板的清单
            if (raw != null && !(raw instanceof List<?> list && list.isEmpty())) {
                throw ApiException.badRequest("该分类没有验货清单，请不要提交清单");
            }
            return null;
        }
        if (!(raw instanceof List<?> list)) {
            throw ApiException.badRequest("该分类需要填写验货清单");
        }
        String templateId = templateRef.templateId();
        Map<String, Boolean> requiredByCode = templateRef.requiredByCode();

        List<InspectionMapper.DisclosureRow> rows = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Object element : list) {
            if (!(element instanceof Map<?, ?> map)) throw ApiException.badRequest("验货清单格式无效");
            for (Object key : map.keySet()) {
                if (!DISCLOSURE_ITEM_FIELDS.contains(String.valueOf(key))) {
                    throw ApiException.badRequest("验货清单包含不支持的字段：" + key);
                }
            }
            String code = map.get("itemCode") instanceof String s ? s : null;
            if (code == null || !requiredByCode.containsKey(code)) throw ApiException.badRequest("验货条目不存在");
            if (!seen.add(code)) throw ApiException.badRequest("验货条目重复");
            String condition = map.get("condition") instanceof String s ? s : null;
            if (condition == null || !CONDITIONS.contains(condition)) throw ApiException.badRequest("验货条目状态无效");
            rows.add(new InspectionMapper.DisclosureRow(code, condition, note(map.get("note"))));
        }
        for (Map.Entry<String, Boolean> entry : requiredByCode.entrySet()) {
            if (entry.getValue() && !seen.contains(entry.getKey())) {
                // 必填项必须逐项表态；「未测试」「不适用」都是合法的表态，但不能不表态
                throw ApiException.badRequest("请逐项填写验货清单中的必填项");
            }
        }
        return new Disclosure(templateId, rows);
    }

    /** 以一份新声明整体替换商品当前声明；null 表示清空（例如切换到不支持的分类）。 */
    @Transactional(propagation = Propagation.MANDATORY)
    public void replaceDisclosure(UUID productId, Disclosure disclosure) {
        inspections.deleteDisclosures(productId);
        if (disclosure != null && !disclosure.rows().isEmpty()) {
            inspections.insertDisclosures(productId, disclosure.templateId(), disclosure.rows());
        }
    }

    /** 商品详情中的卖家声明。没有声明（旧商品或不支持的分类）返回 null。 */
    public Map<String, Object> productDisclosure(UUID productId) {
        List<Map<String, Object>> rows = inspections.selectDisclosures(productId);
        if (rows.isEmpty()) return null;
        String templateId = DomainMapper.text(rows.get(0).get("template_id"));
        Map<String, Object> template = inspections.selectTemplate(templateId);
        Map<String, Map<String, Object>> byCode = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) byCode.put(DomainMapper.text(row.get("item_code")), row);

        Map<String, Object> result = projectTemplate(template, inspections.selectTemplateItems(templateId));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        for (Map<String, Object> item : items) {
            Map<String, Object> declared = byCode.get(item.get("code"));
            item.put("condition", declared == null ? null : DomainMapper.text(declared.get("declared_condition")));
            item.put("note", declared == null ? "" : DomainMapper.text(declared.get("note")));
        }
        return result;
    }

    static String note(Object raw) {
        if (raw == null) return "";
        if (!(raw instanceof String text)) throw ApiException.badRequest("说明格式无效");
        String value = text.strip();
        if (value.length() > MAX_NOTE_LENGTH) throw ApiException.badRequest("说明最多 " + MAX_NOTE_LENGTH + " 个字");
        if (value.indexOf('<') >= 0 || value.indexOf('>') >= 0) throw ApiException.badRequest("说明不能包含尖括号");
        return value;
    }
}
