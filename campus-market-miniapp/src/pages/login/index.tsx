import Taro, { useRouter } from '@tarojs/taro';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api, isDemo } from '../../api';
import { CAMPUSES, type Campus } from '../../model';
import { notify, notifyError, useMarket } from '../../state';
import { PageTitle } from '../../components';

const tabs = ['/pages/market/index', '/pages/publish/index', '/pages/notifications/index', '/pages/profile/index'];
export default function LoginPage() {
  const { setUser } = useMarket(), router = useRouter();
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(''), [password, setPassword] = useState(''), [nickname, setNickname] = useState(''), [contact, setContact] = useState(''), [campus, setCampus] = useState<Campus>('东校区');
  const finish = async () => {
    let target = router.params.returnTo ?? '';
    // 原生页面参数可能保留 URI 编码，H5 路由通常已经解码。
    if (/^%2f/i.test(target)) {
      try { target = decodeURIComponent(target); } catch { target = ''; }
    }
    if (target && tabs.includes(target)) await Taro.switchTab({ url: target });
    else if (target && /^\/pages\/(detail|listings)\/index(?:\?|$)/.test(target)) await Taro.redirectTo({ url: target });
    else await Taro.switchTab({ url: '/pages/market/index' });
  };
  const login = async (demo?: 'buyer' | 'seller') => {
    if (busy) return;
    if (!demo && (!account.trim() || !password || (register && (!nickname.trim() || password.length < 8)))) { notify('请填写账号、密码和注册资料'); return; }
    setBusy(true);
    try {
      const user = demo ? await api.login(demo === 'buyer' ? 'buyer001' : 'seller001', 'demo12345')
        : register ? await api.register({ account: account.trim(), password, nickname: nickname.trim(), campus, contact: contact.trim() }) : await api.login(account, password);
      setUser(user); await finish();
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  return <View className='page login-page'>
    <View className='login-mark'>集</View><PageTitle title={register ? '加入校园集市' : '好物，就在身边'} subtitle='登录后浏览本校闲置，联系同学，约好面交。' />
    <View className='form-card'><Text className='field-label'>学号 / 手机号</Text><Input className='field-input' placeholder='请输入你的平台账号' value={account} onInput={(e) => setAccount(e.detail.value)} maxlength={64} />
      <Text className='field-label'>密码</Text><Input className='field-input' password placeholder={register ? '至少 8 位密码' : '请输入密码'} value={password} onInput={(e) => setPassword(e.detail.value)} maxlength={72} />
      {register && <><Text className='field-label'>昵称</Text><Input className='field-input' placeholder='同学们怎么称呼你' value={nickname} onInput={(e) => setNickname(e.detail.value)} maxlength={40} />
        <Text className='field-label'>所在校区</Text><Picker range={[...CAMPUSES]} value={CAMPUSES.indexOf(campus)} onChange={(e) => setCampus(CAMPUSES[Number(e.detail.value)])}><View className='picker'>{campus} ⌄</View></Picker>
        <Text className='field-label'>联系方式（选填）</Text><Input className='field-input' placeholder='微信号或手机号' value={contact} onInput={(e) => setContact(e.detail.value)} maxlength={100} /></>}
      <Button className='primary' loading={busy} disabled={busy} onClick={() => void login()}>{register ? '注册并登录' : '登录'}</Button>
      <Text className='login-switch' onClick={() => { if (!busy) setRegister(!register); }}>{register ? '已有账号？去登录' : '还没有账号？注册'}</Text>
    </View>
    {isDemo && <View className='demo-card'><Text className='section-title'>先体验一下</Text><Text className='muted'>演示数据只保存在本机。用买家申请联系，再切换卖家审批，体验完整流程。</Text><View className='button-row'><Button className='secondary' disabled={busy} onClick={() => void login('buyer')}>以买家体验</Button><Button className='secondary' disabled={busy} onClick={() => void login('seller')}>以卖家体验</Button></View></View>}
    <Text className='footnote'>学校信息由用户填写，平台目前不核验学籍或身份。</Text>
  </View>;
}
