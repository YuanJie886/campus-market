import Taro from '@tarojs/taro';
import { ensurePrivacy, PrivacyAuthorization } from './privacy';

/** 本次运行唯一的一份隐私授权状态；各页面的 PrivacyPopup 订阅它。 */
export const privacy = new PrivacyAuthorization();
const weapp = process.env.TARO_ENV === 'weapp';

/** 在 App 启动时调用一次：微信暂停隐私接口时把 resolve 交给状态机（不会自动同意）。 */
export function installPrivacyListener() {
  if (!weapp || typeof Taro.onNeedPrivacyAuthorization !== 'function') return;
  Taro.onNeedPrivacyAuthorization((resolve) => privacy.need(resolve));
}

/** 调用选图、登录凭证、剪贴板等接口之前调用；用户拒绝时抛出提示文案。 */
export async function requirePrivacy(): Promise<void> {
  if (!weapp || typeof Taro.getPrivacySetting !== 'function') return;
  const setting = await new Promise<{ needAuthorization: boolean } | null>((resolve) => {
    Taro.getPrivacySetting({ success: (result) => resolve(result), fail: () => resolve(null) });
  });
  await ensurePrivacy(privacy, setting);
}
