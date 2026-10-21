/**
 * 单件发布 / 编辑的请求体（纯函数，不依赖 Taro，便于测试），与 Web ProductForm / MyListingsPage 的提交规则一致：
 * - 取货楼栋始终显式提交（null = 不指定），避免后端「只改校区」的 400 分支；
 * - 可见范围：发布时总是提交；编辑时只在改动过时提交（圈子可见才带 circleIds）；
 * - 教材版本：只有教材书籍分类；发布时有才提交；编辑时只在改动过时提交（null = 解除关联）；
 * - 整套打包编辑时不提交商品级验货声明与教材版本（明细不在这里修改）。
 */
import type { ProductInput, ProductVisibility } from './model';

export const TEXTBOOK_CATEGORY = '教材书籍';
export interface ListingExtras { buildingId: string | null; visibility: ProductVisibility; circleIds: string[]; textbookEditionId: string | null }
export interface ListingOriginal { visibility: ProductVisibility; circleIds: string[]; textbookEditionId: string | null; bundle: boolean }

const sameSet = (a: string[], b: string[]) => [...a].sort().join(',') === [...b].sort().join(',');

export function listingInput(base: ProductInput, extras: ListingExtras, original?: ListingOriginal): ProductInput {
  const input: ProductInput = { ...base, buildingId: extras.buildingId };
  const textbook = base.category === TEXTBOOK_CATEGORY ? extras.textbookEditionId : null;
  if (!original) {
    input.visibility = extras.visibility;
    if (extras.visibility === 'CIRCLE_ONLY') input.circleIds = [...extras.circleIds];
    if (textbook) input.textbookEditionId = textbook;
    return input;
  }
  const nextIds = extras.visibility === 'CIRCLE_ONLY' ? extras.circleIds : [];
  const previousIds = original.visibility === 'CIRCLE_ONLY' ? original.circleIds : [];
  if (extras.visibility !== original.visibility || !sameSet(nextIds, previousIds)) {
    input.visibility = extras.visibility;
    input.circleIds = extras.visibility === 'CIRCLE_ONLY' ? [...extras.circleIds] : [];
  }
  if (original.bundle) { delete input.inspection; return input; }
  if ((textbook ?? null) !== (original.textbookEditionId ?? null)) input.textbookEditionId = textbook ?? null;
  return input;
}

/** 取货楼栋下面的说明：明确写出买家会看到哪一栋楼。 */
export const buildingHelp = (label: string | null) => label ? `买家会在商品页看到：${label}。` : '不指定楼栋时，买家只会看到校区。';
