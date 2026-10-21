/**
 * 卖家声明（模块 3）的展示层映射。
 *
 * <p>这里只做「机器码 → 中文」：业务判断一律使用服务端返回的机器码，中文永远不参与分支。
 * 未知机器码安全降级为通用文案，而不是抛错或原样显示。
 * 订单验货、档期与到达状态随站内交易一起停用（阶段 1），对应的映射已移除。
 */
import type { DeclaredCondition } from '../api/contracts';

export const DECLARED_CONDITION_OPTIONS: DeclaredCondition[] = ['NORMAL', 'DEFECT', 'NOT_TESTED', 'NOT_APPLICABLE'];

const CONDITION_LABEL: Record<DeclaredCondition, string> = {
  NORMAL: '正常',
  DEFECT: '存在问题',
  NOT_TESTED: '未测试',
  NOT_APPLICABLE: '不适用',
};
export function conditionLabel(code: string | null | undefined): string {
  return (code && CONDITION_LABEL[code as DeclaredCondition]) || '未声明';
}
