import Taro from '@tarojs/taro';
let editingId: string | null = null;
let presetTextbookId: string | null = null;
export function editProduct(id: string) { editingId = id; void Taro.switchTab({ url: '/pages/publish/index' }); }
export function takeEditingId() { const id = editingId; editingId = null; return id; }
/** 教材版本页「我有这一版，去发布」：发布页打开这个版本的确认框（是否关联仍由卖家决定）。tabBar 页面不能带参数，所以放在内存里。 */
export function publishWithTextbook(editionId: string) { presetTextbookId = editionId; editingId = null; void Taro.switchTab({ url: '/pages/publish/index' }); }
export function takePresetTextbook() { const id = presetTextbookId; presetTextbookId = null; return id; }
