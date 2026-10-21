import Taro from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../api';
import { changePasswordError, PASSWORD_CHANGED_MESSAGE, PASSWORD_MAX, PASSWORD_MIN } from '../../account';
import { LoginGate, PageTitle } from '../../components';

export default function PasswordPage() {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    const invalid = changePasswordError({ current, next, repeat });
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try {
      await api.changePassword(current, next);
      setCurrent(''); setNext(''); setRepeat('');
      await Taro.showModal({ title: '密码已修改', content: PASSWORD_CHANGED_MESSAGE, showCancel: false, confirmColor: '#194e41' });
      await Taro.navigateBack();
    } catch (e) { setError(e instanceof Error ? e.message : '修改失败，请重试'); } finally { setBusy(false); }
  };

  return <View className='page'>
    <PageTitle title='修改密码' subtitle='修改后，这台设备保持登录，其他设备上的登录全部结束。' />
    <LoginGate returnTo='/pages/profile/index'>
      <View className='form-card'>
        <Text className='field-label'>当前密码</Text>
        <Input className='field-input' password placeholder='请输入当前密码' value={current} maxlength={PASSWORD_MAX} onInput={(e) => setCurrent(e.detail.value)} />
        <Text className='field-label'>新密码</Text>
        <Input className='field-input' password placeholder={`${PASSWORD_MIN}–${PASSWORD_MAX} 位`} value={next} maxlength={PASSWORD_MAX} onInput={(e) => setNext(e.detail.value)} />
        <Text className='field-label'>再次输入新密码</Text>
        <Input className='field-input' password placeholder='再输入一次新密码' value={repeat} maxlength={PASSWORD_MAX} onInput={(e) => setRepeat(e.detail.value)} />
        {error && <Text className='error-text'>{error}</Text>}
        <Button className='primary mt-20' loading={busy} disabled={busy} onClick={() => void submit()}>确认修改</Button>
      </View>
      <Text className='footnote'>忘记当前密码时，请退出登录后在登录页选择「忘记密码？」。</Text>
    </LoginGate>
  </View>;
}
