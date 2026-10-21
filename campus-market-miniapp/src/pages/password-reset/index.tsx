import Taro from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../api';
import { PASSWORD_MAX, PASSWORD_MIN, RESET_HELP, resetPasswordError } from '../../account';
import { PageTitle } from '../../components';

const LOGIN = '/pages/login/index';

/** 公开页面：不需要登录。重置成功后所有设备的登录都会结束，回到登录页用新密码登录。 */
export default function PasswordResetPage() {
  const [account, setAccount] = useState(''), [code, setCode] = useState(''), [next, setNext] = useState(''), [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  const backToLogin = async () => {
    const pages = Taro.getCurrentPages();
    if (pages.length > 1 && pages[pages.length - 2]?.route?.includes(LOGIN.slice(1))) await Taro.navigateBack();
    else await Taro.redirectTo({ url: LOGIN });
  };

  const submit = async () => {
    if (busy) return;
    const invalid = resetPasswordError({ account, code, next, repeat });
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try {
      await api.resetPassword({ account, code, newPassword: next });
      setCode(''); setNext(''); setRepeat('');
      await Taro.showModal({ title: '密码已重置', content: '所有设备上的登录都已结束，请用新密码登录。', showCancel: false, confirmColor: '#194e41' });
      await backToLogin();
    } catch (e) { setError(e instanceof Error ? e.message : '重置失败，请重试'); } finally { setBusy(false); }
  };

  return <View className='page'>
    <PageTitle title='找回密码' subtitle={RESET_HELP} />
    <View className='notice'><Text>平台暂时没有短信或邮件验证。重置码由本校学校管理员线下核对你的身份后签发，只能使用一次，输错 5 次后作废。</Text></View>
    <View className='form-card'>
      <Text className='field-label'>账号</Text>
      <Input className='field-input' placeholder='学号 / 手机号' value={account} maxlength={64} onInput={(e) => setAccount(e.detail.value)} />
      <Text className='field-label'>重置码</Text>
      <Input className='field-input' placeholder='XXXX-XXXX-XXXX，不区分大小写' value={code} maxlength={40} onInput={(e) => setCode(e.detail.value)} />
      <Text className='field-label'>新密码</Text>
      <Input className='field-input' password placeholder={`${PASSWORD_MIN}–${PASSWORD_MAX} 位`} value={next} maxlength={PASSWORD_MAX} onInput={(e) => setNext(e.detail.value)} />
      <Text className='field-label'>再次输入新密码</Text>
      <Input className='field-input' password placeholder='再输入一次新密码' value={repeat} maxlength={PASSWORD_MAX} onInput={(e) => setRepeat(e.detail.value)} />
      {error && <Text className='error-text'>{error}</Text>}
      <Button className='primary mt-20' loading={busy} disabled={busy} onClick={() => void submit()}>重置密码</Button>
      <Text className='login-switch' onClick={() => { if (!busy) void backToLogin(); }}>想起来了？去登录</Text>
    </View>
  </View>;
}
