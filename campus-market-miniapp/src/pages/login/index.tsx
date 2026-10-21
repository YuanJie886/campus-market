import Taro, { useRouter } from '@tarojs/taro';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { api, isDemo, wechatLoginCode, wechatLoginSupported } from '../../api';
import { bindPendingWechat, pendingWechatBind, registerAccount, registrationError, wechatLoginFailure } from '../../account';
import { registrationChoice } from '../../schools';
import { INVITE_INPUT_MAXLENGTH, inviteField, isInviteRequiredError, loginEntryFromParams, normalizeInviteCode } from '../../invite';
import { clientConfig, notify, notifyError, useClientConfig, useMarket, useSchools } from '../../state';
import { AgreementCheck, LegalLinks, PageTitle, PrivacyPopup } from '../../components';

const tabs = ['/pages/market/index', '/pages/publish/index', '/pages/notifications/index', '/pages/profile/index'];

export default function LoginPage() {
  const { setUser } = useMarket(), router = useRouter();
  // 分享出来的注册路径可以带上邀请码（?invite=XXXX-XXXX-XXXX）：直接进入注册并预填
  const [entry] = useState(() => loginEntryFromParams(router.params));
  const [inviteCode, setInviteCode] = useState(entry.inviteCode);
  const [register, setRegister] = useState(entry.register), [busy, setBusy] = useState(false);
  // 试点期只能凭邀请码注册：GET /v1/config 的 registration.inviteRequired 为 true 时显示必填的邀请码输入框
  const invite = inviteField(useClientConfig());
  // 微信一键登录：服务端开通后才显示；未绑定时手里有一张内存里的绑定票据，等账号密码登录 / 注册成功后绑定
  const [wechatEnabled, setWechatEnabled] = useState(false), [bindPending, setBindPending] = useState(pendingWechatBind.pending);
  // 注册前必须勾选同意《用户协议》《隐私政策》；每次进入登录页都需要重新勾选
  const [agreed, setAgreed] = useState(false);
  const [account, setAccount] = useState(''), [password, setPassword] = useState(''), [nickname, setNickname] = useState(''), [contact, setContact] = useState('');
  // 注册：先选学校，再选校区（都来自 GET /v1/schools）；只有一所学校时不显示学校选择
  const [schoolId, setSchoolId] = useState<string | null>(null), [campusId, setCampusId] = useState<string | null>(null);
  const { catalog, error: schoolsError, retry: retrySchools } = useSchools();
  const choice = registrationChoice(catalog, schoolId, campusId), campus = choice.campus?.id ?? '';

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

  // 进入注册时重新读取一次配置，是否需要邀请码以服务端当前设置为准
  useEffect(() => { if (register) void clientConfig.refresh(); }, [register]);

  useEffect(() => {
    if (!wechatLoginSupported) return;
    let alive = true;
    api.wechatStatus().then((status) => { if (alive) setWechatEnabled(status.enabled); }).catch(() => { if (alive) setWechatEnabled(false); });
    return () => { alive = false; };
  }, []);

  const login = async (demo?: 'buyer' | 'seller') => {
    if (busy) return;
    if (!demo && !register && (!account.trim() || !password)) { notify('请填写账号和密码'); return; }
    const registration = { account, password, nickname, campus, contact, inviteCode };
    if (!demo && register) { const error = registrationError(registration, agreed, invite.required); if (error) { notify(error); return; } }
    setBusy(true);
    try {
      // 演示账号只在演示构建里出现（__API_MODE__ 是构建期常量，REST 产物里这段会被删掉）
      const user = demo && __API_MODE__ === 'mock' ? await api.login(demo === 'buyer' ? 'buyer001' : 'seller001', 'demo12345')
        : register ? await registerAccount(api, registration, agreed, invite.required) : await api.login(account, password);
      setUser(user);
      const hadTicket = bindPending, bound = await bindPendingWechat(api);
      setBindPending(false);
      if (bound) notify(bound); else if (hadTicket) notify('微信绑定已过期，请重新使用微信一键登录');
      await finish();
    } catch (e) {
      // 后端已改为需要邀请码而本地配置还没更新：重新读取配置，输入框随即出现；提示一律用后端原文
      if (isInviteRequiredError(e)) void clientConfig.refresh();
      notifyError(e);
    } finally { setBusy(false); }
  };

  const wechatLogin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.wechatLogin(await wechatLoginCode());
      if (result.bound) { pendingWechatBind.clear(); setBindPending(false); setUser(result.user); await finish(); return; }
      pendingWechatBind.hold(result.bindTicket); setBindPending(true);
    } catch (e) {
      const failure = wechatLoginFailure(e);
      if (failure.hide) setWechatEnabled(false);
      notify(failure.message);
    } finally { setBusy(false); }
  };

  return <View className='page login-page'>
    <View className='login-mark'>集</View>
    <PageTitle title={register ? '加入校园集市' : '好物，就在身边'} subtitle='登录后浏览本校闲置，联系同学，约好面交。' />
    {bindPending && <View className='notice bind-notice'>
      <Text>这个微信还没有绑定校园集市账号。请用账号密码登录或注册，成功后会自动绑定，下次就能一键登录。</Text>
      <Text className='text-action' onClick={() => { if (!busy) { pendingWechatBind.clear(); setBindPending(false); } }}>不绑定</Text>
    </View>}
    <View className='form-card'>
      <Text className='field-label'>学号 / 手机号</Text>
      <Input className='field-input' placeholder='请输入你的平台账号' value={account} onInput={(e) => setAccount(e.detail.value)} maxlength={64} />
      <Text className='field-label'>密码</Text>
      <Input className='field-input' password placeholder={register ? '至少 8 位密码' : '请输入密码'} value={password} onInput={(e) => setPassword(e.detail.value)} maxlength={72} />
      {register && <>
        {invite.visible && <>
          <Text className='field-label'>{invite.label}</Text>
          <Input className='field-input' placeholder={invite.placeholder} value={inviteCode} onInput={(e) => setInviteCode(normalizeInviteCode(e.detail.value))} maxlength={INVITE_INPUT_MAXLENGTH} />
          <Text className='field-help'>{invite.help}</Text>
        </>}
        <Text className='field-label'>昵称</Text>
        <Input className='field-input' placeholder='同学们怎么称呼你' value={nickname} onInput={(e) => setNickname(e.detail.value)} maxlength={40} />
        {choice.showSchoolPicker ? <>
          <Text className='field-label'>学校</Text>
          <Picker range={choice.schools.map((s) => s.name)} value={Math.max(0, choice.schools.findIndex((s) => s.id === choice.school?.id))} onChange={(e) => { const next = choice.schools[Number(e.detail.value)]; if (next) { setSchoolId(next.id); setCampusId(null); } }}>
            <View className='picker'><Text className='picker-value'>{choice.school?.name ?? '请选择学校'}</Text><View className='i-chevron' /></View>
          </Picker>
        </> : choice.school ? <Text className='field-help'>学校：{choice.school.name}</Text> : null}
        <Text className='field-label'>所在校区</Text>
        <Picker disabled={!choice.school} range={choice.campuses.map((c) => c.name)} value={Math.max(0, choice.campuses.findIndex((c) => c.id === choice.campus?.id))} onChange={(e) => { const next = choice.campuses[Number(e.detail.value)]; if (next) setCampusId(next.id); }}>
          <View className='picker'><Text className='picker-value'>{choice.campus?.name ?? (choice.school ? '请选择校区' : '请先选择学校')}</Text><View className='i-chevron' /></View>
        </Picker>
        {schoolsError ? <View className='notice'><Text>{schoolsError}</Text><Text className='text-action' onClick={retrySchools}>重试</Text></View>
          : catalog.loaded && !choice.schools.length ? <Text className='error-text'>暂时没有开放注册的学校</Text> : null}
        <Text className='field-label'>联系方式 <Text className='optional'>选填</Text></Text>
        <Input className='field-input' placeholder='微信号或手机号' value={contact} onInput={(e) => setContact(e.detail.value)} maxlength={100} />
      </>}
      {register && <AgreementCheck checked={agreed} onChange={setAgreed} />}
      <Button className='primary' loading={busy} disabled={busy || (register && !agreed)} onClick={() => void login()}>{register ? '注册并登录' : '登录'}</Button>
      <Text className='login-switch' onClick={() => { if (!busy) setRegister(!register); }}>{register ? '已有账号？去登录' : '还没有账号？注册'}</Text>
      {!register && <Text className='login-switch forgot-link' onClick={() => { if (!busy) void Taro.navigateTo({ url: '/pages/password-reset/index' }); }}>忘记密码？</Text>}
    </View>
    {wechatEnabled && !bindPending && <View className='form-card'>
      <Button className='secondary' disabled={busy} onClick={() => void wechatLogin()}>微信一键登录</Button>
      <Text className='muted wechat-hint'>首次使用需要用账号密码登录一次完成绑定。{isDemo ? '演示模式使用模拟的微信身份，不会调用微信。' : ''}</Text>
    </View>}
    {isDemo && <View className='demo-card'>
      <Text className='section-title'>先体验一下</Text>
      <Text className='muted'>演示数据只保存在本机。用买家申请联系，再切换卖家审批，体验完整流程。</Text>
      <View className='button-row'><Button className='secondary' disabled={busy} onClick={() => void login('buyer')}>以买家体验</Button><Button className='secondary' disabled={busy} onClick={() => void login('seller')}>以卖家体验</Button></View>
    </View>}
    {!register && <Text className='footnote legal-footnote'>登录即表示你已阅读并同意<LegalLinks /></Text>}
    <Text className='footnote'>学校信息由用户填写，平台目前不核验学籍或身份。</Text>
    <PrivacyPopup />
  </View>;
}
