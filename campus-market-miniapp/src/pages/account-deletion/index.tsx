import Taro from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api, forgetLocalAccountState } from '../../api';
import { DELETE_CONFIRMATION, DELETION_BLOCKERS, DELETION_EFFECTS, DELETION_KEPT, deletionError, pendingWechatBind } from '../../account';
import { LoginGate, PageTitle } from '../../components';
import { useMarket } from '../../state';

export default function AccountDeletionPage() {
  const { setUser } = useMarket();
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    const invalid = deletionError({ password, confirmation });
    if (invalid) { setError(invalid); return; }
    setError('');
    const answer = await Taro.showModal({ title: '确认注销账号？', content: '注销后无法恢复：资料会匿名化，所有设备立即退出登录。', confirmText: '注销', confirmColor: '#b4432f' });
    if (!answer.confirm) return;
    setBusy(true);
    try {
      await api.deleteAccount({ password, confirmation: confirmation.trim() });
      setPassword(''); setConfirmation('');
      pendingWechatBind.clear(); forgetLocalAccountState(); setUser(null);
      await Taro.showModal({ title: '账号已注销', content: '感谢你使用校园集市。', showCancel: false, confirmColor: '#194e41' });
      await Taro.reLaunch({ url: '/pages/market/index' });
    } catch (e) {
      // 后端 409（仍有后台权限 / 仍是圈子所有者）等原因原样展示
      setError(e instanceof Error ? e.message : '注销失败，请重试');
    } finally { setBusy(false); }
  };

  return <View className='page'>
    <PageTitle title='注销账号' subtitle='注销是自助的，提交后立即生效，无法撤销。' />
    <LoginGate returnTo='/pages/profile/index'>
      <View className='panel'>
        <Text className='section-title'>注销会做什么</Text>
        {DELETION_EFFECTS.map((line) => <Text key={line} className='bullet'>{line}</Text>)}
      </View>
      <View className='panel'>
        <Text className='section-title'>会保留的记录</Text>
        {DELETION_KEPT.map((line) => <Text key={line} className='bullet'>{line}</Text>)}
      </View>
      <View className='panel'>
        <Text className='section-title'>需要先处理</Text>
        {DELETION_BLOCKERS.map((line) => <Text key={line} className='bullet'>{line}</Text>)}
      </View>
      <View className='form-card'>
        <Text className='field-label'>当前密码</Text>
        <Input className='field-input' password placeholder='请输入当前密码' value={password} maxlength={72} onInput={(e) => setPassword(e.detail.value)} />
        <Text className='field-label'>请输入「{DELETE_CONFIRMATION}」</Text>
        <Input className='field-input' placeholder={DELETE_CONFIRMATION} value={confirmation} maxlength={10} onInput={(e) => setConfirmation(e.detail.value)} />
        {error && <Text className='error-text'>{error}</Text>}
        <Button className='danger-button mt-20' loading={busy} disabled={busy} onClick={() => void submit()}>注销账号</Button>
      </View>
    </LoginGate>
  </View>;
}
