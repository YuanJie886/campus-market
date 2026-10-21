/**
 * 「我的」页的入口（纯数据，不依赖 Taro，便于测试路径都已在 app.config 注册）。
 * 「更多」分组按数组追加；第二部分的新功能都在分包里（packages/…），不占主包体积。
 */
export const PAGES = {
  messages: '/pages/messages/index',
  conversation: '/pages/conversation/index',
  myReports: '/pages/my-reports/index',
  myRestrictions: '/pages/my-restrictions/index',
  profileEdit: '/pages/profile-edit/index',
} as const;

/** 分包：毕业季快速发布与协助整理。 */
export const SUPPLY_PAGES = { batches: '/packages/supply/batches/index', assist: '/packages/supply/assist/index' } as const;
/** 分包：圈子。 */
export const CIRCLE_PAGES = {
  list: '/packages/circles/index/index', create: '/packages/circles/create/index', join: '/packages/circles/join/index',
  detail: '/packages/circles/detail/index', products: '/packages/circles/products/index', manage: '/packages/circles/manage/index',
} as const;
/** 分包：需求匹配与订阅。 */
export const DEMAND_PAGES = { inbox: '/packages/demand/index/index' } as const;
/** 分包：课程教材。 */
export const TEXTBOOK_PAGES = {
  courses: '/packages/textbooks/courses/index', course: '/packages/textbooks/course/index',
  textbook: '/packages/textbooks/textbook/index', suggestions: '/packages/textbooks/suggestions/index',
} as const;

/** app.config 里的分包（root + 相对页面路径），由上面的常量推导，保证入口与注册一致。 */
export const SUB_PACKAGES = (Object.entries({ supply: SUPPLY_PAGES, circles: CIRCLE_PAGES, demand: DEMAND_PAGES, textbooks: TEXTBOOK_PAGES }) as [string, Record<string, string>][])
  .map(([name, pages]) => ({ root: `packages/${name}`, pages: Object.values(pages).map((url) => url.slice(`/packages/${name}/`.length)) }));

export interface MenuEntry { key: string; label: string; hint: string; url: string }

export const MORE_ENTRIES: readonly MenuEntry[] = [
  { key: 'demand', label: '需求匹配', hint: '订阅与匹配收件箱', url: DEMAND_PAGES.inbox },
  { key: 'circles', label: '我的圈子', hint: '班级、社团、兴趣', url: CIRCLE_PAGES.list },
  { key: 'batches', label: '毕业季快速发布', hint: '一次整理多件', url: SUPPLY_PAGES.batches },
  { key: 'assist', label: '协助整理发布', hint: '用邀请码帮同学整理', url: SUPPLY_PAGES.assist },
  { key: 'courses', label: '课程教材', hint: '按课程找教材', url: TEXTBOOK_PAGES.courses },
  { key: 'suggestions', label: '我的教材建议', hint: '只有自己可见', url: TEXTBOOK_PAGES.suggestions },
  { key: 'reports', label: '我的举报', hint: '查看处理进度', url: PAGES.myReports },
  { key: 'restrictions', label: '我的限制与申诉', hint: '限制、处理记录', url: PAGES.myRestrictions },
];
