import Taro from '@tarojs/taro';
import type { MarketApi } from '../model';
import { RestApi } from './rest';
import { Transport, type UploadPort } from './transport';
import { requirePrivacy } from '../privacyGuard';
export const isDemo = __API_MODE__ === 'mock';
const native = process.env.TARO_ENV !== 'h5';
/** 微信一键登录需要 wx.login：真实接口只在微信小程序里提供；演示模式用模拟凭证，任何端都可以体验。 */
export const wechatLoginSupported = isDemo || process.env.TARO_ENV === 'weapp';
let expired = () => {};
export function bindSessionExpiry(callback: () => void) { expired = callback; return () => { expired = () => {}; }; }
/** 商品图片上传：Taro.uploadFile（multipart 字段 file），把进度转给调用方。 */
const uploadPort: UploadPort = (input, onProgress) => {
  const task = Taro.uploadFile(input);
  if (onProgress && typeof task.onProgressUpdate === 'function') task.onProgressUpdate((event) => onProgress(event.progress));
  return task.then((result) => ({ statusCode: result.statusCode, data: result.data }));
};
const transport = new Transport((input) => Taro.request({ ...input, credentials: 'include' }), __API_BASE_URL__, native, () => expired(), uploadPort);
const DEMO_STORAGE_KEY = 'campus_miniapp_demo_v1';

function createApi(): MarketApi {
  // 演示实现（含演示账号与模拟微信身份）只在演示构建里加载：__API_MODE__ 是构建期常量，
  // REST 构建里这个分支是死代码，webpack 不会把 ./mock 打进产物。
  if (__API_MODE__ === 'mock') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MockApi } = require('./mock') as typeof import('./mock');
    return new MockApi({ get: () => Taro.getStorageSync(DEMO_STORAGE_KEY), set: (db) => Taro.setStorageSync(DEMO_STORAGE_KEY, db) });
  }
  return new RestApi(transport);
}
export const api: MarketApi = createApi();
/** 显示用的图片地址：REST 下 /v1/ 开头的签名地址拼上接口域名；演示下换回本机文件。 */
export const imageSrc = (url: string | undefined) => (url ? api.imageSrc(url) : '');

/** 取得一次性的微信登录凭证。演示模式用固定的模拟凭证（同一台设备 = 同一个演示微信），不调用微信。 */
export async function wechatLoginCode(): Promise<string> {
  if (__API_MODE__ === 'mock') return 'demo_wechat_device';
  await requirePrivacy();
  const { code } = await Taro.login();
  if (!code) throw new Error('没有拿到微信登录凭证，请重试');
  return code;
}

/**
 * 注销后清掉本机与账号有关的存储。真实接口模式下令牌与 Cookie 本来只在内存（已由 RestApi 丢弃），这里再清空本小程序的本地存储，
 * 不留任何残余；演示模式的本地库就是「服务端」，注销已经写进去了，不能清空。
 */
export function forgetLocalAccountState() {
  if (__API_MODE__ !== 'mock') { try { Taro.clearStorageSync(); } catch { /* 本地存储不可用时没有可清的内容 */ } }
}
