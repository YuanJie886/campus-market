import Taro from '@tarojs/taro';
let editingId: string | null = null;
export function editProduct(id: string) { editingId = id; void Taro.switchTab({ url: '/pages/publish/index' }); }
export function takeEditingId() { const id = editingId; editingId = null; return id; }
