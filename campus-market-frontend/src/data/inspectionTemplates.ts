import type { InspectionTemplate } from '../api/contracts';
import type { Category } from '../types';

/**
 * 离线 Mock 的验货模板，与后端 V5 迁移（V5__trusted_meeting_flow.sql）的种子逐条一致：
 * 机器码、文案、必填、顺序都相同。本文件由迁移脚本生成，测试会逐条对照，
 * 任何一边改动而另一边没改都会立刻失败。「其他」分类没有模板。
 */
export interface MockInspectionTemplate extends InspectionTemplate {
  id: string;
}

export const seedInspectionTemplates: MockInspectionTemplate[] = [
  {
    id: 'tpl-digital-v1', category: '数码电子' as Category, version: 1, title: '数码电子验货清单',
    items: [
      { code: 'POWER_ON', label: '能正常开机', description: '开机进入系统，无反复重启', required: true },
      { code: 'SCREEN', label: '屏幕显示正常', description: '无碎裂、坏点、大面积色斑或触控失灵', required: true },
      { code: 'BATTERY', label: '电池状况与描述一致', description: '续航或电池健康度与卖家描述相符', required: true },
      { code: 'PORTS_BUTTONS', label: '按键与接口正常', description: '实体按键、充电口、耳机口可用', required: true },
      { code: 'CAMERA_AUDIO', label: '摄像头与声音正常', description: '拍照、扬声器、麦克风可用（无此功能可选不适用）', required: false },
      { code: 'ACCOUNT_UNBOUND', label: '已退出账号或解除绑定', description: '无激活锁、云账号或设备绑定残留', required: true },
      { code: 'ACCESSORIES', label: '配件与描述一致', description: '充电器、数据线、包装等', required: false },
      { code: 'APPEARANCE', label: '外观与描述一致', description: '划痕、磕碰程度与描述相符', required: true },
    ],
  },
  {
    id: 'tpl-books-v1', category: '教材书籍' as Category, version: 1, title: '教材书籍验货清单',
    items: [
      { code: 'EDITION', label: '版本与描述一致', description: '书名、版次、ISBN 相符', required: true },
      { code: 'PAGES_COMPLETE', label: '无缺页撕页', description: '', required: true },
      { code: 'NOTES', label: '笔记划线与描述一致', description: '笔记、划线、答案填写的程度', required: true },
      { code: 'COVER', label: '封面书脊完好', description: '', required: false },
      { code: 'WATER_DAMAGE', label: '无水渍霉斑', description: '', required: true },
    ],
  },
  {
    id: 'tpl-daily-v1', category: '生活用品' as Category, version: 1, title: '生活用品验货清单',
    items: [
      { code: 'FUNCTION', label: '功能正常', description: '主要功能可以使用', required: true },
      { code: 'APPEARANCE', label: '外观与描述一致', description: '', required: true },
      { code: 'CLEAN', label: '清洁无异味', description: '', required: true },
      { code: 'PARTS_COMPLETE', label: '部件齐全', description: '', required: true },
      { code: 'ELECTRICAL', label: '电器线材无破损', description: '非电器可选不适用', required: false },
    ],
  },
  {
    id: 'tpl-apparel-v1', category: '服饰鞋包' as Category, version: 1, title: '服饰鞋包验货清单',
    items: [
      { code: 'SIZE', label: '尺码与描述一致', description: '', required: true },
      { code: 'STAINS', label: '无明显污渍', description: '', required: true },
      { code: 'DAMAGE', label: '无破损开线', description: '', required: true },
      { code: 'MATERIAL', label: '材质与描述一致', description: '', required: false },
      { code: 'WEAR', label: '磨损程度与描述一致', description: '鞋底、包角、起球等', required: true },
    ],
  },
  {
    id: 'tpl-sports-v1', category: '运动户外' as Category, version: 1, title: '运动户外验货清单',
    items: [
      { code: 'STRUCTURE', label: '结构无裂纹变形', description: '车架、拍框、器械主体', required: true },
      { code: 'FUNCTION', label: '功能正常', description: '', required: true },
      { code: 'WEAR', label: '磨损与描述一致', description: '', required: true },
      { code: 'PARTS_COMPLETE', label: '配件齐全', description: '', required: false },
      { code: 'SAFETY', label: '安全部件完好', description: '刹车、绑带、锁扣等', required: true },
    ],
  },
];
