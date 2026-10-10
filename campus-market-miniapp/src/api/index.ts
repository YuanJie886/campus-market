import Taro from '@tarojs/taro';
import type { MarketApi } from '../model';
import { MockApi } from './mock';
import { RestApi } from './rest';
import { Transport } from './transport';
export const isDemo = __API_MODE__ === 'mock';
export const uploadConfigured = isDemo || Boolean(__UPLOAD_URL__);
const native = process.env.TARO_ENV !== 'h5';
let expired = () => {};
export function bindSessionExpiry(callback: () => void) { expired = callback; return () => { expired = () => {}; }; }
const transport = new Transport((input) => Taro.request({ ...input, credentials: 'include' }), __API_BASE_URL__, native, () => expired());
export const api: MarketApi = isDemo
  ? new MockApi({ get: () => Taro.getStorageSync('campus_miniapp_demo_v1'), set: (db) => Taro.setStorageSync('campus_miniapp_demo_v1', db) })
  : new RestApi(transport, async (filePath, authorization) => {
    if (!__UPLOAD_URL__) throw new Error('尚未配置图片上传服务，请先配置上传地址');
    if (!/^https?:\/\//.test(__UPLOAD_URL__)) throw new Error('图片上传地址必须为 HTTP(S) 地址');
    const result = await Taro.uploadFile({ url: __UPLOAD_URL__, filePath, name: 'file', header: { Authorization: authorization } });
    let body: { code?: number; message?: string; data?: { url?: string } };
    try { body = JSON.parse(result.data); } catch { throw new Error('上传服务返回了无效数据'); }
    if (result.statusCode >= 400 || body.code !== 0 || !body.data?.url || !/^https?:\/\//.test(body.data.url)) throw new Error(body.message || '图片上传失败，请重试');
    return body.data.url;
  });
