import Taro from '@tarojs/taro';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api, isDemo } from '../../api';
import { LoginGate, PageTitle } from '../../components';
import { CAMPUSES, type Campus } from '../../model';
import { goLogin, notify, notifyError, useMarket } from '../../state';

export default function ProfilePage() {
  const { user, setUser, favorites } = useMarket();
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [nickname, setNickname] = useState(''), [campus, setCampus] = useState<Campus>('东校区'), [contact, setContact] = useState('');
  const logout = async (switchDemo = false) => {
    if (busy) return;
    const result = await Taro.showModal({ title: switchDemo ? '切换演示身份？' : '退出当前账号？', content: switchDemo ? '演示商品和申请会保留，可以换一个身份继续体验。' : '退出后需要重新登录才能浏览本校商品。', confirmColor: '#194e41' });
    if (!result.confirm) return; setBusy(true);
    try { await api.logout(); setUser(null); setEditing(false); if (switchDemo) goLogin('/pages/profile/index'); }
    catch (e) { setUser(null); setEditing(false); notifyError(e); } finally { setBusy(false); }
  };
  return <View className='page'><PageTitle title='我的校园集市' subtitle='管理你的闲置，也收藏下一件喜欢的好物。' /><LoginGate returnTo='/pages/profile/index'>
    <View className='profile-card'><View className='avatar large-avatar'>{user?.nickname.slice(0, 1)}</View><View><Text className='profile-name'>{user?.nickname}</Text><Text className='subtitle'>{user?.campus} · 同校交易</Text></View><Text className='text-action' onClick={() => { setNickname(user?.nickname ?? ''); setCampus(user?.campus ?? '东校区'); setContact(user?.contact ?? ''); setEditing(!editing); }}>{editing ? '收起' : '编辑资料'}</Text></View>
    {editing && <View className='form-card'><Text className='field-label'>昵称</Text><Input className='field-input' value={nickname} maxlength={40} onInput={(e) => setNickname(e.detail.value)} /><Text className='field-label'>校区</Text><Picker range={[...CAMPUSES]} value={CAMPUSES.indexOf(campus)} onChange={(e) => setCampus(CAMPUSES[Number(e.detail.value)])}><View className='picker'>{campus} ⌄</View></Picker><Text className='field-label'>联系方式</Text><Input className='field-input' value={contact} maxlength={100} onInput={(e) => setContact(e.detail.value)} /><Button className='primary' disabled={busy} loading={busy} onClick={async () => { if (busy) return; if (!nickname.trim()) { notify('昵称不能为空'); return; } setBusy(true); try { setUser(await api.updateProfile({ nickname: nickname.trim(), campus, contact: contact.trim() })); setEditing(false); notify('资料已保存'); } catch (e) { notifyError(e); } finally { setBusy(false); } }}>保存资料</Button></View>}
    <View className='menu-panel'><View className='menu-row' onClick={() => void Taro.navigateTo({ url: '/pages/listings/index' })}><Text>▤　我的发布</Text><Text className='muted'>管理闲置 ›</Text></View><View className='menu-row' onClick={() => void Taro.navigateTo({ url: '/pages/listings/index?kind=favorites' })}><Text>♡　我的收藏</Text><Text className='muted'>{favorites.length} 件 ›</Text></View><View className='menu-row' onClick={() => void Taro.switchTab({ url: '/pages/notifications/index' })}><Text>◇　联系申请</Text><Text className='muted'>查看和处理 ›</Text></View></View>
    {isDemo && <View className='demo-card'><Text className='section-title'>演示体验</Text><Text className='muted'>可以切换买家与卖家，查看同一条联系申请在双方页面上的变化。</Text><Button className='secondary' disabled={busy} onClick={() => void logout(true)}>切换演示身份</Button></View>}
    <Button className='quiet-button' disabled={busy} onClick={() => void logout()}>退出登录</Button><Text className='footnote'>只和本校同学交易。平台目前不核验学籍或身份，联系方式按卖家的公开选择与申请审批展示。</Text>
  </LoginGate></View>;
}
