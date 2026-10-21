import Taro, { useRouter } from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { api } from '../../../api';
import { LoginGate, PageTitle } from '../../../components';
import { USER_CREATED_NOTE } from '../../../circles';
import { tokenFromInput } from '../../../supply';
import { CIRCLE_PAGES } from '../../../menu';
import { useMarket } from '../../../state';
import { clearPendingInvite, holdPendingInvite, peekPendingInvite } from '../pending';

/**
 * 用邀请码加入圈子：可以手动输入，也可以粘贴 Web 的邀请链接（…#code=…），或从带 code 参数的小程序页面打开。
 * 邀请码只放在兑换请求的请求体里；未登录时只暂存在本次运行的内存里，登录回来后自动填入，仍需点击「加入」。
 * 无效、过期、已用、已撤销的邀请码显示同一句提示，不透露圈子是否存在。
 */
export default function CircleJoinPage() {
  const { user } = useMarket(), router = useRouter();
  const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const fromLink = router.params.code ? tokenFromInput(decodeURIComponent(router.params.code)) : '';
    if (fromLink) holdPendingInvite(fromLink);
    const held = fromLink || peekPendingInvite();
    if (held) setToken(held);
  }, []);
  const redeem = async () => {
    const value = tokenFromInput(token);
    if (!value || busy) return;
    setBusy(true); setError('');
    try { const circle = await api.redeemCircleInvite(value); setToken(''); clearPendingInvite(); void Taro.redirectTo({ url: `${CIRCLE_PAGES.detail}?id=${encodeURIComponent(circle.id)}` }); }
    catch (e) { setError(e instanceof Error ? e.message : '加入失败，请重试'); }
    finally { setBusy(false); }
  };
  return <View className='page'>
    <PageTitle title='用邀请码加入圈子' />
    {!user && token ? <Text className='notice sheet-line'>已收到邀请码。登录或注册后会回到这里，由你确认是否加入。邀请码只保存在本次运行的内存里，不会写进本地存储；关闭小程序后需要重新打开邀请。</Text> : null}
    <LoginGate returnTo={CIRCLE_PAGES.join}>
      <Text className='muted sheet-line'>{USER_CREATED_NOTE}每个邀请码只能使用一次。</Text>
      {token ? <Text className='field-help'>邀请码已自动填好，确认后点击「加入」。</Text> : null}
      <View className='form-card'>
        <Text className='field-label'>邀请码</Text>
        <Input className='field-input' value={token} maxlength={300} placeholder='邀请码或邀请链接' onInput={(e) => setToken(e.detail.value)} />
        {error ? <Text className='error-text'>{error}</Text> : null}
        <Button className='primary mt-12' disabled={busy || !token.trim()} loading={busy} onClick={() => void redeem()}>加入</Button>
      </View>
    </LoginGate>
  </View>;
}
