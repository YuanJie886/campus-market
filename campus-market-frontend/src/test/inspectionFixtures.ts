/**
 * 测试夹具：为受支持分类生成完整的卖家声明，以及让买家把验货全部标为 MATCH 并提交。
 *
 * 模块 3 起，受支持分类发布时必须逐项声明、买家确认前必须先提交验货；
 * 既有测试关注的是别的行为，因此通过这里补齐前置条件，而不是放宽任何断言。
 */
import type { CampusMarketApi, DeclaredCondition, DisclosureInput } from '../api/contracts';
import { seedInspectionTemplates } from '../data/inspectionTemplates';

export function fullDisclosure(category: string, condition: DeclaredCondition = 'NORMAL'): DisclosureInput[] | undefined {
  const template = seedInspectionTemplates.find((t) => t.category === category);
  return template?.items.map((item) => ({ itemCode: item.code, condition }));
}

/** 当前登录者须为买家；只有在待面交且验货待提交时才动作。 */
export async function submitAllMatch(api: CampusMarketApi, orderId: string): Promise<void> {
  const flow = await api.getOrderFlow(orderId);
  if (flow.status !== 'PENDING_MEETING' || flow.inspection.status !== 'PENDING') return;
  await api.submitInspection(orderId, flow.inspection.items.map((i) => ({ itemCode: i.code, result: 'MATCH' as const })));
}
