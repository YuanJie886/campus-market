/**
 * 测试夹具：为受支持分类生成完整的卖家声明。
 *
 * 模块 3 起，受支持分类发布时必须逐项声明；既有测试关注的是别的行为，
 * 因此通过这里补齐前置条件，而不是放宽任何断言。
 */
import type { DeclaredCondition, DisclosureInput } from '../api/contracts';
import { seedInspectionTemplates } from '../data/inspectionTemplates';

export function fullDisclosure(category: string, condition: DeclaredCondition = 'NORMAL'): DisclosureInput[] | undefined {
  const template = seedInspectionTemplates.find((t) => t.category === category);
  return template?.items.map((item) => ({ itemCode: item.code, condition }));
}
