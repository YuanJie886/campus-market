import Taro from '@tarojs/taro';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../../api';
import { LoginGate, PageTitle, PrivacyPopup } from '../../components';
import type { Building } from '../../model';
import { buildingPickerState } from '../../schools';
import { DORM_HELP, DORM_SCOPE_HELP, NICKNAME_MAX, buildingsIn, keepBuilding, profileError, profileInput, zonesOf, type ProfileForm } from '../../profile';
import { AVATAR_PRESETS } from '../../avatar';
import { photoLimits, IMAGE_TOO_LARGE } from '../../images';
import { isPrivacyDenied, PRIVACY_REQUIRED_MESSAGE } from '../../privacy';
import { requirePrivacy } from '../../privacyGuard';
import { notify, useClientConfig, useMarket } from '../../state';
import { Avatar } from '../../widgets/Avatar';
import { CampusPicker } from '../../widgets/CampusPicker';
import { uploadPhoto } from '../../widgets/PhotoField';

/**
 * 编辑资料（与 Web「个人资料」一致）：头像（预设）、昵称、校区、联系方式、宿舍楼（选填，只有本人可见）。
 * 昵称被内容安全拦截等服务端 400 原样显示在保存按钮上方。
 */
export default function ProfileEditPage() {
  const { user, setUser } = useMarket();
  const [form, setForm] = useState<ProfileForm>({ nickname: '', campus: user?.campus ?? '', contact: '', avatar: '', dormBuildingId: null });
  const [original, setOriginal] = useState(''), [originalAvatar, setOriginalAvatar] = useState(''), [preview, setPreview] = useState(''), [uploading, setUploading] = useState(false), [buildings, setBuildings] = useState<Building[]>([]), [zone, setZone] = useState('');
  const [buildingsLoaded, setBuildingsLoaded] = useState(false), [buildingError, setBuildingError] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const identity = useRef(user?.id); identity.current = user?.id;

  // 打开时读取本人完整资料（含头像与宿舍楼）；读取失败时用登录时的资料
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    setReady(false);
    api.me().catch(() => user).then((me) => {
      if (uid !== identity.current) return;
      setForm({ nickname: me.nickname, campus: me.campus, contact: me.contact ?? '', avatar: me.avatar ?? '', dormBuildingId: me.dormBuildingId ?? null });
      setOriginal(me.contact ?? ''); setOriginalAvatar(me.avatar ?? ''); setPreview(''); setReady(true);
    });
  }, [user?.id]);
  // 校区一变就重新读取楼栋；原来的宿舍楼不属于新校区时清空
  useEffect(() => {
    if (!ready) return;
    let active = true; setBuildingError(''); setBuildingsLoaded(false);
    api.buildings(form.campus).then((list) => {
      if (!active) return;
      setBuildings(list); setZone(''); setBuildingsLoaded(true);
      setForm((f) => ({ ...f, dormBuildingId: keepBuilding(list, f.dormBuildingId) }));
    }).catch((e) => { if (active) { setBuildings([]); setBuildingError(e instanceof Error ? e.message : '楼栋读取失败'); } });
    return () => { active = false; };
  }, [form.campus, ready]);

  const set = (change: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...change }));
  const selected = buildings.find((b) => b.id === form.dormBuildingId) ?? null;
  const activeZone = zone || selected?.zone || '';
  const zones = zonesOf(buildings), visible = buildingsIn(buildings, activeZone);
  // 本校区还没有启用的楼栋：不显示宿舍楼选择，说明「本校楼栋信息还在录入中」
  const dormState = buildingPickerState(buildings);

  const { maxBytes } = photoLimits(useClientConfig());
  /** 上传一张头像：选图前先确认隐私授权；上传得到的引用（upload:<id>）在保存时提交，预览用本机文件。 */
  const uploadAvatar = async () => {
    if (uploading) return;
    setUploading(true); setError('');
    try {
      await requirePrivacy();
      const picked = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      const file = picked.tempFiles[0];
      if (!file) return;
      if (typeof file.size === 'number' && file.size > maxBytes) { setError(IMAGE_TOO_LARGE); return; }
      const image = await uploadPhoto({ key: 'avatar', preview: file.tempFilePath, ref: '', status: 'uploading', progress: 0, error: '', filePath: file.tempFilePath }, () => undefined);
      set({ avatar: image.ref }); setPreview(isDemo ? api.imageSrc(image.url) : file.tempFilePath);
    } catch (e) {
      const message = (e as { errMsg?: string })?.errMsg ?? '';
      if (!message.includes('cancel')) setError(isPrivacyDenied(e) ? PRIVACY_REQUIRED_MESSAGE : e instanceof Error ? e.message : '头像上传失败，请重试');
    } finally { setUploading(false); }
  };
  const choose = (avatar: string) => { set({ avatar }); setPreview(''); };

  const save = async () => {
    if (busy || !user || uploading) return;
    const problem = profileError(form, { contact: original });
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try { setUser(await api.updateProfile(profileInput(form, user, originalAvatar))); notify('资料已更新'); void Taro.navigateBack().catch(() => undefined); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };

  return <View className='page'>
    <PageTitle title='编辑资料' />
    <LoginGate returnTo='/pages/profile-edit/index'>
      {!ready ? <Text className='muted'>正在读取资料…</Text> : <View className='form-card'>
        <Text className='field-label'>头像</Text>
        <View className='avatar-current'>
          <Avatar value={form.avatar} userId={user?.id} nickname={form.nickname || user?.nickname} size='large' preview={preview} />
          <Text className='field-help'>{form.avatar === '' ? '不使用头像：显示昵称第一个字' : '预览'}</Text>
        </View>
        <Text className='field-label'>选择头像</Text>
        <View className='avatar-grid'>
          {AVATAR_PRESETS.map((value) => <View key={value} className={`avatar-option ${form.avatar === value ? 'active' : ''}`} onClick={() => choose(value)}><Avatar value={value} userId={user?.id} nickname={form.nickname || user?.nickname} /></View>)}
        </View>
        <View className='button-row'>
          <Button className='secondary small' disabled={uploading} loading={uploading} onClick={() => void uploadAvatar()}>上传头像</Button>
          <Button className={`secondary small ${form.avatar === '' ? 'active' : ''}`} onClick={() => choose('')}>不使用头像</Button>
        </View>
        <Text className='field-label'>昵称</Text>
        <Input className='field-input' value={form.nickname} maxlength={NICKNAME_MAX} onInput={(e) => set({ nickname: e.detail.value })} />
        <Text className='field-label'>学号 / 手机号（不可修改）</Text>
        <Input className='field-input' value={user?.account ?? ''} disabled />
        <Text className='field-label'>所在校区</Text>
        <CampusPicker value={form.campus} onChange={(campus) => set({ campus })} />
        <Text className='field-label'>联系方式</Text>
        <Input className='field-input' value={form.contact} maxlength={100} onInput={(e) => set({ contact: e.detail.value })} />
        <Text className='field-help'>手机号或学号，仅交易对方可见；留空时使用账号</Text>
        <Text className='field-label'>宿舍楼（选填）</Text>
        {buildingError ? <Text className='error-text'>{buildingError}</Text> : buildingsLoaded && dormState.pending ? <Text className='field-help'>{dormState.text}</Text> : <>
          <Picker range={['不填写', ...zones]} value={activeZone ? zones.indexOf(activeZone) + 1 : 0} onChange={(e) => { const i = Number(e.detail.value); setZone(i ? zones[i - 1] : ''); if (!i) set({ dormBuildingId: null }); else if (selected && selected.zone !== zones[i - 1]) set({ dormBuildingId: null }); }}>
            <View className='picker'><Text className='picker-value'>{activeZone || '宿舍园区：不填写'}</Text><View className='i-chevron' /></View>
          </Picker>
          <Picker range={['不填写', ...visible.map((b) => `${b.zone} · ${b.name}`)]} value={selected ? visible.findIndex((b) => b.id === selected.id) + 1 : 0} onChange={(e) => { const i = Number(e.detail.value); set({ dormBuildingId: i ? visible[i - 1].id : null }); }}>
            <View className='picker mt-12'><Text className='picker-value'>{selected ? `${selected.zone} · ${selected.name}` : '宿舍楼：不填写'}</Text><View className='i-chevron' /></View>
          </Picker>
        </>}
        <Text className='field-help'>{DORM_SCOPE_HELP}。{DORM_HELP}</Text>
        {error ? <Text className='error-text'>{error}</Text> : null}
        <Button className='primary mt-20' disabled={busy} loading={busy} onClick={() => void save()}>保存修改</Button>
      </View>}
    </LoginGate>
    <PrivacyPopup />
  </View>;
}
