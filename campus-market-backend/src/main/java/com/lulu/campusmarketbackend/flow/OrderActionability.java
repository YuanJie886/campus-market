package com.lulu.campusmarketbackend.flow;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 订单「此刻能做什么」的唯一口径（3.8A）。
 *
 * <p>状态机本身（谁能在什么状态迁移到什么状态）仍由 {@code OrderTransitionExecutor} 决定；
 * 这里只回答界面需要提前知道的两件事：买家现在确认面交会不会被放行、为什么不行。
 * 执行器的验货闸门、订单流程视图、订单列表摘要都调用这里，前端只读结果、不复制条件。
 *
 * <p>所有原因都是稳定机器码，中文只在前端映射。
 */
public final class OrderActionability {

    public static final Set<String> TERMINAL = Set.of("COMPLETED", "CANCELLED", "EXPIRED");

    private OrderActionability() {}

    /**
     * 买家确认面交的阻断原因；{@code null} 表示允许。
     *
     * @param inspectionStatus order_inspections.status；旧订单没有记录时为 {@code null}
     */
    public static String buyerConfirmBlockReason(String orderStatus, String inspectionStatus) {
        if (TERMINAL.contains(orderStatus)) return "ORDER_TERMINAL";
        if ("DISPUTED".equals(orderStatus)) return "INSPECTION_MISMATCH";
        if ("BUYER_CONFIRMED".equals(orderStatus) || "SELLER_CONFIRMED".equals(orderStatus)) return "ALREADY_CONFIRMED";
        if (!"PENDING_MEETING".equals(orderStatus)) return "ORDER_NOT_IN_MEETING";
        return inspectionGate(inspectionStatus);
    }

    /**
     * 验货闸门：确认面交与核销确认码共用。
     * 无清单（NOT_PROVIDED）与旧订单（无记录）不受影响，保持原流程。
     */
    public static String inspectionGate(String inspectionStatus) {
        if ("PENDING".equals(inspectionStatus)) return "INSPECTION_REQUIRED";
        if ("NEEDS_RESOLUTION".equals(inspectionStatus)) return "INSPECTION_MISMATCH";
        return null;
    }

    /** 该订单是否带有结构化验货清单（需要买家逐项提交）。 */
    public static boolean inspectionRequired(String inspectionStatus) {
        return "PENDING".equals(inspectionStatus) || "SUBMITTED".equals(inspectionStatus)
                || "NEEDS_RESOLUTION".equals(inspectionStatus);
    }

    /**
     * 当前面交安排的状态：
     * AWAITING_SELLER（卖家尚未接受，还没有正式档期）、CONFIRMED（有正式档期）、
     * RESCHEDULE_PENDING（有正式档期，另有一条改约提议待回应）、CLOSED（不再约时间）。
     */
    public static String meetingStatus(String orderStatus, boolean hasPendingProposal) {
        if ("PENDING_SELLER_CONFIRM".equals(orderStatus)) return "AWAITING_SELLER";
        if ("PENDING_MEETING".equals(orderStatus)) return hasPendingProposal ? "RESCHEDULE_PENDING" : "CONFIRMED";
        return "CLOSED";
    }

    /** 订单列表 / 流程视图共用的摘要投影。 */
    public static Map<String, Object> summary(String orderStatus, String inspectionStatus, boolean hasPendingProposal,
                                              String myPresence, String counterpartPresence) {
        String reason = buyerConfirmBlockReason(orderStatus, inspectionStatus);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("inspectionRequired", inspectionRequired(inspectionStatus));
        result.put("inspectionStatus", inspectionStatus == null ? "LEGACY_NONE" : inspectionStatus);
        result.put("buyerConfirmAllowed", reason == null);
        result.put("buyerConfirmBlockReason", reason);
        result.put("currentMeetingStatus", meetingStatus(orderStatus, hasPendingProposal));
        result.put("myPresenceStatus", myPresence == null ? "NOT_STARTED" : myPresence);
        result.put("counterpartyPresenceStatus", counterpartPresence == null ? "NOT_STARTED" : counterpartPresence);
        return result;
    }
}
