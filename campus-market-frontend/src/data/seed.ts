import type {
  Campus,
  Category,
  ChatMessage,
  Comment,
  Condition,
  Conversation,
  Favorite,
  MarketState,
  Order,
  Product,
  ProductStatus,
  User,
} from '../types';

/**
 * 演示用种子数据。
 * 首次进入或重置演示数据时写入 localStorage，之后以 localStorage 为准。
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.now();

/** 一键体验账号 */
export const DEMO_ACCOUNT = '2021001';
export const DEMO_PASSWORD = '123456';

const CATEGORY_IMAGE_SETS: Record<Category, string[]> = {
  数码电子: [
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=88',
  ],
  教材书籍: [
    'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=88',
  ],
  生活用品: [
    'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1200&q=88',
  ],
  服饰鞋包: [
    'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1622560480605-d83c853bc5c3?auto=format&fit=crop&w=1200&q=88',
  ],
  运动户外: [
    'https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1520045892732-304bc3ac5d8e?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1507035895480-2b3156c31fc8?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1547447134-cd3f5c716030?auto=format&fit=crop&w=1200&q=88',
  ],
  其他: [
    'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1525201548942-d8732f6617a0?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1513828583688-c52646db42da?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?auto=format&fit=crop&w=1200&q=88',
  ],
};

const PRODUCT_IMAGE_OVERRIDES: Record<string, string[]> = {
  p01: [
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=1200&q=88',
  ],
  p02: [
    'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1561154464-82e9adf32764?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1585790050230-5dd28404ccb9?auto=format&fit=crop&w=1200&q=88',
  ],
  p03: [
    'https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1586920740199-47ce0a7f6b4e?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?auto=format&fit=crop&w=1200&q=88',
  ],
  p05: [
    'https://images.unsplash.com/photo-1506880018603-83d5b814b5a6?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=1200&q=88',
  ],
  p11: [
    'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=1200&q=88',
  ],
  p16: [
    'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=88',
  ],
  p17: [
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=1200&q=88',
  ],
  p21: [
    'https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1507035895480-2b3156c31fc8?auto=format&fit=crop&w=1200&q=88',
  ],
  p25: [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?auto=format&fit=crop&w=1200&q=88',
    'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=1200&q=88',
  ],
};

function img(seed: string, category?: Category, index = 0): string {
  const productId = seed.replace(/-b$|-c$/, '');
  const override = PRODUCT_IMAGE_OVERRIDES[productId];
  if (override?.length) return override[index % override.length];
  const set = category ? CATEGORY_IMAGE_SETS[category] : undefined;
  if (set?.length) return set[index % set.length];
  return `https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=88`;
}

function avatar(seed: string): string {
  return `https://picsum.photos/seed/${seed}/200/200`;
}

/* -------------------------------- 用户 -------------------------------- */

export const seedUsers: User[] = [
  {
    id: 'u_demo',
    account: DEMO_ACCOUNT,
    password: DEMO_PASSWORD,
    nickname: '小鹿同学',
    avatar: avatar('cm-avatar-demo'),
    campus: '东校区',
    contact: '13800008001',
    createdAt: NOW - 120 * DAY,
  },
  {
    id: 'u_lin',
    account: '2021002',
    password: '123456',
    nickname: '林小满',
    avatar: avatar('cm-avatar-lin'),
    campus: '西校区',
    contact: '13900008002',
    createdAt: NOW - 110 * DAY,
  },
  {
    id: 'u_zhao',
    account: '2021003',
    password: '123456',
    nickname: '赵一鸣',
    avatar: avatar('cm-avatar-zhao'),
    campus: '南校区',
    contact: '13700008003',
    createdAt: NOW - 95 * DAY,
  },
  {
    id: 'u_chen',
    account: '2021004',
    password: '123456',
    nickname: '陈思远',
    avatar: avatar('cm-avatar-chen'),
    campus: '北校区',
    contact: '13600008004',
    createdAt: NOW - 80 * DAY,
  },
  {
    id: 'u_wang',
    account: '2021005',
    password: '123456',
    nickname: '王小米',
    avatar: avatar('cm-avatar-wang'),
    campus: '东校区',
    contact: '13500008005',
    createdAt: NOW - 60 * DAY,
  },
];

const contactOf = (userId: string): string =>
  seedUsers.find((u) => u.id === userId)?.contact ?? '13800000000';

/* -------------------------------- 商品 -------------------------------- */

interface ProductSeed {
  id: string;
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: Category;
  condition: Condition;
  campus: Campus;
  sellerId: string;
  views: number;
  hoursAgo: number;
  status?: ProductStatus;
  meetupPoint?: string;
}

function buildProduct(s: ProductSeed): Product {
  const status: ProductStatus = s.status ?? '在售';
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    price: s.price,
    originalPrice: s.originalPrice,
    category: s.category,
    condition: s.condition,
    campus: s.campus,
    images: [
      img(s.id, s.category, 0),
      img(`${s.id}-b`, s.category, 1),
      img(`${s.id}-c`, s.category, 2),
    ],
    contact: contactOf(s.sellerId),
    sellerId: s.sellerId,
    status,
    views: s.views,
    createdAt: NOW - s.hoursAgo * HOUR,
    soldAt:
      status === '已售出'
        ? NOW - Math.max(1, s.hoursAgo - 6) * HOUR
        : undefined,
    meetupPoint: s.meetupPoint ?? `${s.campus}图书馆或学苑食堂`,
  };
}

const productSeeds: ProductSeed[] = [
  {
    id: 'p01',
    title: 'iPhone 13 128G 蓝色 国行',
    description:
      '自用主力机，无拆无修，电池健康度 92%，一直带壳贴膜使用，外观 95 新。配件齐全（原装充电线 + 包装盒），支持当面验机，可在东校区菜鸟驿站面交。',
    price: 3200,
    originalPrice: 5999,
    category: '数码电子',
    condition: '轻微使用痕迹',
    campus: '东校区',
    sellerId: 'u_lin',
    views: 356,
    hoursAgo: 5,
  },
  {
    id: 'p02',
    title: 'iPad Air 4 64G WiFi版 深空灰',
    description:
      '买来记笔记用的，几乎没怎么用，屏幕无划痕，已贴类纸膜。附赠 Apple Pencil 一代和磁吸保护壳，一起打包出。',
    price: 2200,
    originalPrice: 4399,
    category: '数码电子',
    condition: '几乎全新',
    campus: '西校区',
    sellerId: 'u_lin',
    views: 289,
    hoursAgo: 26,
    status: '已售出',
  },
  {
    id: 'p03',
    title: '罗技 MX Master 3 无线鼠标',
    description:
      '办公神器，多设备切换非常顺滑。用了半年，功能一切正常，滚轮无卡顿，含 Type-C 充电线。',
    price: 380,
    originalPrice: 699,
    category: '数码电子',
    condition: '轻微使用痕迹',
    campus: '南校区',
    sellerId: 'u_zhao',
    views: 142,
    hoursAgo: 30,
  },
  {
    id: 'p04',
    title: '小米手环 8 NFC 版',
    description:
      '全新未拆封，生日礼物重复了所以出掉。支持门禁卡模拟、公交卡，续航约 16 天。',
    price: 150,
    originalPrice: 269,
    category: '数码电子',
    condition: '全新',
    campus: '东校区',
    sellerId: 'u_demo',
    views: 96,
    hoursAgo: 8,
  },
  {
    id: 'p05',
    title: 'Kindle Paperwhite 4 电子书阅读器',
    description:
      '8G 版本，带背光，泡面盖神器（笑）。看书很护眼，电池续航久，含原装保护套，无划痕。',
    price: 420,
    originalPrice: 998,
    category: '数码电子',
    condition: '几乎全新',
    campus: '北校区',
    sellerId: 'u_chen',
    views: 178,
    hoursAgo: 52,
  },
  {
    id: 'p06',
    title: '高等数学 第七版 上下册 同济大学',
    description:
      '同济版高数教材，上册有少量笔记（铅笔），下册几乎全新。考研复习必备，两本一起出。',
    price: 45,
    originalPrice: 89,
    category: '教材书籍',
    condition: '轻微使用痕迹',
    campus: '东校区',
    sellerId: 'u_wang',
    views: 210,
    hoursAgo: 12,
  },
  {
    id: 'p07',
    title: '线性代数 第六版 同济大学',
    description: '课本基本没翻过，干净无笔记，考试周救急好物，低价出。',
    price: 20,
    originalPrice: 38,
    category: '教材书籍',
    condition: '几乎全新',
    campus: '东校区',
    sellerId: 'u_wang',
    views: 88,
    hoursAgo: 14,
  },
  {
    id: 'p08',
    title: '考研英语一 历年真题 黄皮书',
    description:
      '2010-2023 真题全套，做过一遍（用铅笔），解析完整。附赠自己整理的高频词汇笔记一份。',
    price: 60,
    originalPrice: 158,
    category: '教材书籍',
    condition: '轻微使用痕迹',
    campus: '南校区',
    sellerId: 'u_zhao',
    views: 134,
    hoursAgo: 20,
  },
  {
    id: 'p09',
    title: 'C Primer Plus 第6版 中文版',
    description: 'C 语言入门经典，厚厚一本，几乎全新，适合计算机专业新生。',
    price: 55,
    originalPrice: 128,
    category: '教材书籍',
    condition: '几乎全新',
    campus: '西校区',
    sellerId: 'u_lin',
    views: 76,
    hoursAgo: 40,
  },
  {
    id: 'p10',
    title: '大学物理 上下册 第五版',
    description:
      '课本有明显翻阅痕迹，扉页有名字，内页完整无缺页，适合预算有限的同学。',
    price: 40,
    originalPrice: 96,
    category: '教材书籍',
    condition: '明显使用痕迹',
    campus: '北校区',
    sellerId: 'u_chen',
    views: 63,
    hoursAgo: 70,
  },
  {
    id: 'p11',
    title: '小米台灯 Pro 护眼版',
    description:
      '无频闪护眼台灯，支持无级调光调色温，宿舍学习好搭档。用了一学期，功能正常。',
    price: 130,
    originalPrice: 249,
    category: '生活用品',
    condition: '几乎全新',
    campus: '东校区',
    sellerId: 'u_demo',
    views: 118,
    hoursAgo: 18,
  },
  {
    id: 'p12',
    title: '宿舍小冰箱 海尔 42L 单门',
    description:
      '毕业清仓，制冷正常，噪音小，带冷冻室。仅限自提（东校区 3 号楼），可帮忙搬到楼下。',
    price: 380,
    originalPrice: 799,
    category: '生活用品',
    condition: '轻微使用痕迹',
    campus: '南校区',
    sellerId: 'u_zhao',
    views: 245,
    hoursAgo: 44,
  },
  {
    id: 'p13',
    title: '美的电热水壶 1.5L',
    description: '不锈钢内胆，烧水快，自动断电。用了一学年，外观有小磕碰，不影响使用。',
    price: 45,
    originalPrice: 99,
    category: '生活用品',
    condition: '轻微使用痕迹',
    campus: '东校区',
    sellerId: 'u_demo',
    views: 72,
    hoursAgo: 33,
  },
  {
    id: 'p14',
    title: '折叠床上书桌 懒人桌',
    description: '宿舍床上学习神器，可折叠收纳，桌面干净无破损。低价出，自提优先。',
    price: 35,
    originalPrice: 79,
    category: '生活用品',
    condition: '几乎全新',
    campus: '北校区',
    sellerId: 'u_chen',
    views: 91,
    hoursAgo: 60,
  },
  {
    id: 'p15',
    title: 'Nike Air Force 1 白色 42码',
    description:
      '经典小白鞋，42 码，穿过几次，鞋底轻微磨损，已清洗干净，无开胶。鞋盒齐全。',
    price: 400,
    originalPrice: 799,
    category: '服饰鞋包',
    condition: '轻微使用痕迹',
    campus: '东校区',
    sellerId: 'u_wang',
    views: 302,
    hoursAgo: 9,
  },
  {
    id: 'p16',
    title: '优衣库 摇粒绒外套 男 L 码',
    description: '秋冬保暖必备，L 码，穿过两次，无起球无污渍，颜色为藏青色。',
    price: 80,
    originalPrice: 199,
    category: '服饰鞋包',
    condition: '几乎全新',
    campus: '西校区',
    sellerId: 'u_lin',
    views: 87,
    hoursAgo: 36,
  },
  {
    id: 'p17',
    title: 'JanSport 双肩包 学院风',
    description: '美式经典书包，容量大，可放 15.6 寸笔记本，背带舒适。用了一年，成色好。',
    price: 120,
    originalPrice: 359,
    category: '服饰鞋包',
    condition: '轻微使用痕迹',
    campus: '南校区',
    sellerId: 'u_zhao',
    views: 154,
    hoursAgo: 48,
  },
  {
    id: 'p18',
    title: '阿迪达斯 运动长裤 M 码',
    description: '全新带吊牌，买大了没穿，M 码，黑色三条杠经典款。',
    price: 90,
    originalPrice: 299,
    category: '服饰鞋包',
    condition: '全新',
    campus: '北校区',
    sellerId: 'u_chen',
    views: 66,
    hoursAgo: 55,
  },
  {
    id: 'p19',
    title: '捷安特 ATX 660 山地车 26寸',
    description:
      '代步好车，变速顺畅，刹车灵敏，刚做过保养。含车锁和打气筒，仅限东校区自提。',
    price: 850,
    originalPrice: 1780,
    category: '运动户外',
    condition: '轻微使用痕迹',
    campus: '东校区',
    sellerId: 'u_wang',
    views: 268,
    hoursAgo: 7,
  },
  {
    id: 'p20',
    title: '迪卡侬 羽毛球拍 双拍套装',
    description: '入门双拍套装，含 3 个球和拍包，几乎全新，适合新手约球。',
    price: 70,
    originalPrice: 149,
    category: '运动户外',
    condition: '几乎全新',
    campus: '西校区',
    sellerId: 'u_lin',
    views: 103,
    hoursAgo: 28,
  },
  {
    id: 'p21',
    title: '李宁 篮球 7号 室内外通用',
    description: '全新未开封，7 号标准球，手感好，室内外通用。买重了所以出。',
    price: 60,
    originalPrice: 129,
    category: '运动户外',
    condition: '全新',
    campus: '东校区',
    sellerId: 'u_demo',
    views: 58,
    hoursAgo: 22,
  },
  {
    id: 'p22',
    title: '卡西欧 fx-991CN X 科学计算器',
    description: '考试指定型号，功能完好，屏幕清晰，附原装保护盖。',
    price: 95,
    originalPrice: 179,
    category: '其他',
    condition: '几乎全新',
    campus: '南校区',
    sellerId: 'u_zhao',
    views: 121,
    hoursAgo: 16,
  },
  {
    id: 'p23',
    title: '尤克里里 23寸 初学者套装',
    description: '含琴包、调音器、备用弦和教程书，音准好，适合零基础入门。',
    price: 150,
    originalPrice: 399,
    category: '其他',
    condition: '几乎全新',
    campus: '北校区',
    sellerId: 'u_chen',
    views: 97,
    hoursAgo: 42,
  },
  {
    id: 'p24',
    title: '民谣吉他 41寸 单板',
    description: '面单吉他，音色饱满，手感舒适，附琴包和背带。已售出，感谢支持～',
    price: 450,
    originalPrice: 899,
    category: '其他',
    condition: '轻微使用痕迹',
    campus: '东校区',
    sellerId: 'u_demo',
    views: 187,
    hoursAgo: 96,
    status: '已售出',
  },
  {
    id: 'p25',
    title: '索尼 WH-1000XM4 头戴降噪耳机',
    description:
      '降噪效果一流，图书馆自习神器。用了不到一年，耳罩无脱皮，含收纳盒和数据线。',
    price: 1200,
    originalPrice: 2299,
    category: '数码电子',
    condition: '轻微使用痕迹',
    campus: '东校区',
    sellerId: 'u_wang',
    views: 331,
    hoursAgo: 3,
  },
  {
    id: 'p26',
    title: '自行车骑行头盔 均码',
    description: '全新未使用，均码可调节，带反光条，安全骑行必备。',
    price: 50,
    originalPrice: 119,
    category: '运动户外',
    condition: '全新',
    campus: '南校区',
    sellerId: 'u_zhao',
    views: 44,
    hoursAgo: 64,
  },
];

export const seedProducts: Product[] = productSeeds.map(buildProduct);

/* ------------------------------- 留言板 ------------------------------- */

export const seedComments: Comment[] = [
  {
    id: 'c01',
    productId: 'p01',
    userId: 'u_demo',
    content: '请问电池健康度是多少呀？有电子发票吗？',
    createdAt: NOW - 4 * HOUR,
    parentId: null,
  },
  {
    id: 'c02',
    productId: 'p01',
    userId: 'u_lin',
    content: '电池 92%，电子发票可以发给你，需要的哈～',
    createdAt: NOW - 3.5 * HOUR,
    parentId: 'c01',
  },
  {
    id: 'c03',
    productId: 'p01',
    userId: 'u_zhao',
    content: '还在吗？可以小刀吗？',
    createdAt: NOW - 2 * HOUR,
    parentId: null,
  },
  {
    id: 'c04',
    productId: 'p19',
    userId: 'u_chen',
    content: '车子是哪年买的？能约南校区看车吗？',
    createdAt: NOW - 6 * HOUR,
    parentId: null,
  },
  {
    id: 'c05',
    productId: 'p25',
    userId: 'u_lin',
    content: '耳机还在保修期内吗？',
    createdAt: NOW - 1 * HOUR,
    parentId: null,
  },
];

/* ------------------------------- 收藏 ------------------------------- */

export const seedFavorites: Favorite[] = [
  { id: 'f01', userId: 'u_demo', productId: 'p01', createdAt: NOW - 3 * HOUR },
  { id: 'f02', userId: 'u_demo', productId: 'p19', createdAt: NOW - 5 * HOUR },
  { id: 'f03', userId: 'u_wang', productId: 'p04', createdAt: NOW - 2 * HOUR },
  { id: 'f04', userId: 'u_zhao', productId: 'p11', createdAt: NOW - 9 * HOUR },
];

/* ------------------------------- 订单 ------------------------------- */

export const seedOrders: Order[] = [
  {
    id: 'o01',
    productId: 'p02',
    buyerId: 'u_demo',
    sellerId: 'u_lin',
    price: 2200,
    status: '待确认',
    createdAt: NOW - 20 * HOUR,
    updatedAt: NOW - 20 * HOUR,
  },
  {
    id: 'o02',
    productId: 'p24',
    buyerId: 'u_chen',
    sellerId: 'u_demo',
    price: 450,
    status: '已完成',
    createdAt: NOW - 92 * HOUR,
    updatedAt: NOW - 88 * HOUR,
    buyerReview: {
      rating: 5,
      comment: '卖家人很好，吉他音色很棒，成色比描述还好！',
      createdAt: NOW - 87 * HOUR,
    },
    sellerReview: {
      rating: 5,
      comment: '买家爽快，沟通顺畅，推荐！',
      createdAt: NOW - 86 * HOUR,
    },
  },
];

/* ------------------------------- 会话 ------------------------------- */

export const seedConversations: Conversation[] = [
  {
    id: 'conv01',
    productId: 'p01',
    buyerId: 'u_demo',
    sellerId: 'u_lin',
    createdAt: NOW - 4.2 * HOUR,
    updatedAt: NOW - 1 * HOUR,
  },
];

export const seedMessages: ChatMessage[] = [
  {
    id: 'm01',
    conversationId: 'conv01',
    senderId: 'u_demo',
    content: '你好，iPhone 13 还在吗？',
    createdAt: NOW - 4.2 * HOUR,
  },
  {
    id: 'm02',
    conversationId: 'conv01',
    senderId: 'u_lin',
    content: '在的，可以约东校区菜鸟驿站面交～',
    createdAt: NOW - 4 * HOUR,
  },
  {
    id: 'm03',
    conversationId: 'conv01',
    senderId: 'u_demo',
    content: '好的，我明天下午有空，方便吗？',
    createdAt: NOW - 3 * HOUR,
  },
  {
    id: 'm04',
    conversationId: 'conv01',
    senderId: 'u_lin',
    content: '可以呀，明天下午三点菜鸟驿站见～',
    createdAt: NOW - 1 * HOUR,
  },
];

/** 完整种子市场状态 */
export function buildSeedMarketState(): MarketState {
  return {
    products: JSON.parse(JSON.stringify(seedProducts)) as Product[],
    orders: JSON.parse(JSON.stringify(seedOrders)) as Order[],
    comments: JSON.parse(JSON.stringify(seedComments)) as Comment[],
    favorites: JSON.parse(JSON.stringify(seedFavorites)) as Favorite[],
    conversations: JSON.parse(
      JSON.stringify(seedConversations),
    ) as Conversation[],
    messages: JSON.parse(JSON.stringify(seedMessages)) as ChatMessage[],
  };
}
