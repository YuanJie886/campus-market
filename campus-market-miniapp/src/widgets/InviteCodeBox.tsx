import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { isPrivacyDenied, PRIVACY_REQUIRED_MESSAGE } from '../privacy';
import { requirePrivacy } from '../privacyGuard';
import { notify } from '../state';

/**
 * 只显示这一次的邀请码：只在页面内存里，不写本地存储、不放进页面路径；隐藏或离开页面后无法再次查看。
 * 复制写剪贴板是微信隐私接口：先确认用户已同意隐私政策。
 */
export function InviteCodeBox({ title, token, note, onHide }: { title: string; token: string; note: string; onHide: () => void }) {
  const copy = async () => {
    try { await requirePrivacy(); await Taro.setClipboardData({ data: token }); }
    catch (e) { notify(isPrivacyDenied(e) ? PRIVACY_REQUIRED_MESSAGE : '无法自动复制，请手动选中复制'); }
  };
  return <View className='invite-box'>
    <Text className='section-title'>{title}</Text>
    <Text className='invite-token' userSelect>{token}</Text>
    <Text className='field-help'>{note}</Text>
    <View className='button-row'>
      <Button className='secondary small' onClick={() => void copy()}>复制邀请码</Button>
      <Button className='secondary small' onClick={onHide}>我已保存，隐藏邀请码</Button>
    </View>
  </View>;
}
