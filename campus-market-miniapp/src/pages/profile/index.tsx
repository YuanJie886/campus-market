import Taro, { useDidShow } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../../api';
import type { WechatStatus } from '../../model';
import { LoginGate, PageTitle } from '../../components';
import { PRIVACY_PAGE, TERMS_PAGE } from '../../legal';
import { MORE_ENTRIES, PAGES } from '../../menu';
import { Avatar } from '../../widgets/Avatar';
import { badgeText } from '../../contacts';
import { goLogin, notify, notifyError, useDemandUnread, useMarket, useMessageUnread, useUnread } from '../../state';

export default function ProfilePage() {
  const { user, setUser, favorites } = useMarket();
  const unreadCount = useUnread().total, messageCount = useMessageUnread(), demandCount = useDemandUnread();
  const [wechat, setWechat] = useState<WechatStatus | null>(null), identity = useRef(user?.id); identity.current = user?.id;
  const [busy, setBusy] = useState(false);

  const loadWechat = () => {
    const uid = user?.id; if (!uid) { setWechat(null); return; }
    api.wechatStatus().then((status) => { if (uid === identity.current) setWechat(status); }).catch(() => { if (uid === identity.current) setWechat(null); });
  };
  useEffect(loadWechat, [user?.id]);
  useDidShow(loadWechat);

  const unbindWechat = async () => {
    if (busy) return;
    const answer = await Taro.showModal({ title: '解除微信绑定？', content: '解除后不能再用这个微信一键登录，需要用账号密码登录；之后可以在登录页重新绑定。', confirmText: '解除绑定', confirmColor: '#b4432f' });
    if (!answer.confirm) return; setBusy(true);
    try { await api.wechatUnbind(); notify('已解除微信绑定'); loadWechat(); }
    catch (e) { notifyError(e); } finally { setBusy(false); }
  };

  const logout = async (switchDemo = false) => {
    if (busy) return;
    const result = await Taro.showModal({ title: switchDemo ? '切换演示身份？' : '退出当前账号？', content: switchDemo ? '演示商品和申请会保留，可以换一个身份继续体验。' : '退出后需要重新登录才能浏览本校商品。', confirmColor: '#194e41' });
    if (!result.confirm) return; setBusy(true);
    try { await api.logout(); setUser(null); if (switchDemo) goLogin('/pages/profile/index'); }
    catch (e) { setUser(null); notifyError(e); } finally { setBusy(false); }
  };

  return <View className='page'>
    <PageTitle title='我的' subtitle='管理你的闲置，也收藏下一件喜欢的好物。' />
    <LoginGate returnTo='/pages/profile/index'>
      <View className='profile-card'>
        <Avatar value={user?.avatar} userId={user?.id} nickname={user?.nickname} size='large' />
        <View className='profile-info'>
          <Text className='profile-name'>{user?.nickname}</Text>
          <Text className='subtitle'>{user?.campus} · 同校交易</Text>
        </View>
        <Text className='text-action' onClick={() => void Taro.navigateTo({ url: PAGES.profileEdit })}>编辑资料</Text>
      </View>

      <View className='menu-panel'>
        <View className='menu-row' onClick={() => void Taro.navigateTo({ url: '/pages/listings/index' })}><Text className='menu-text'>我的发布</Text><Text className='menu-value'>管理<View className='i-chevron-r' /></Text></View>
        <View className='menu-row' onClick={() => void Taro.navigateTo({ url: '/pages/listings/index?kind=favorites' })}><Text className='menu-text'>我的收藏</Text><Text className='menu-value'>{favorites.length} 件<View className='i-chevron-r' /></Text></View>
        <View className='menu-row' onClick={() => void Taro.switchTab({ url: '/pages/notifications/index' })}><Text className='menu-text'>联系申请</Text><Text className='menu-value'>{unreadCount ? `${unreadCount} 条未读` : '查看和处理'}<View className='i-chevron-r' /></Text></View>
        <View className='menu-row' onClick={() => void Taro.navigateTo({ url: PAGES.messages })}><Text className='menu-text'>私信</Text><Text className='menu-value'>{messageCount ? `${badgeText(messageCount)} 条未读` : '快捷消息'}<View className='i-chevron-r' /></Text></View>
      </View>

      <View className='menu-panel'>
        <Text className='menu-group'>更多</Text>
        {MORE_ENTRIES.map((entry) => <View className='menu-row' key={entry.key} onClick={() => void Taro.navigateTo({ url: entry.url })}><Text className='menu-text'>{entry.label}</Text><Text className='menu-value'>{entry.key === 'demand' && demandCount ? `${badgeText(demandCount)} 条未读` : entry.hint}<View className='i-chevron-r' /></Text></View>)}
      </View>

      <View className='menu-panel'>
        <View className='menu-row'>
          <Text className='menu-text'>微信绑定</Text>
          {!wechat ? <Text className='menu-value'>—</Text>
            : !wechat.enabled ? <Text className='menu-value'>{wechat.bound ? '已绑定（微信登录暂未开通）' : '微信登录尚未开通'}</Text>
              : <Text className='menu-value'>{wechat.bound ? '已绑定' : '未绑定'}</Text>}
          {wechat?.bound && <Text className='text-action danger-text' onClick={() => void unbindWechat()}>解除绑定</Text>}
        </View>
        {wechat?.enabled && !wechat.bound && <Text className='muted menu-note'>退出后在登录页选择「微信一键登录」，按提示用账号密码登录一次即可绑定。</Text>}
        <View className='menu-row' onClick={() => void Taro.navigateTo({ url: '/pages/password/index' })}><Text className='menu-text'>修改密码</Text><Text className='menu-value'>其他设备会退出<View className='i-chevron-r' /></Text></View>
        <View className='menu-row' onClick={() => void Taro.navigateTo({ url: '/pages/account-deletion/index' })}><Text className='menu-text danger-text'>注销账号</Text><Text className='menu-value'>不可恢复<View className='i-chevron-r' /></Text></View>
      </View>

      {isDemo && <View className='demo-card'>
        <Text className='section-title'>演示体验</Text>
        <Text className='muted'>可以切换买家与卖家，查看同一条联系申请在双方页面上的变化。</Text>
        <Button className='secondary' disabled={busy} onClick={() => void logout(true)}>切换演示身份</Button>
      </View>}

      <Button className='quiet-button' disabled={busy} onClick={() => void logout()}>退出登录</Button>
      <Text className='footnote'>只和本校同学交易。平台目前不核验学籍或身份，联系方式按卖家的公开选择与申请审批展示。</Text>
    </LoginGate>
    <View className='menu-panel'>
      <View className='menu-row' onClick={() => void Taro.navigateTo({ url: TERMS_PAGE })}><Text className='menu-text'>用户协议</Text><Text className='menu-value'>草案<View className='i-chevron-r' /></Text></View>
      <View className='menu-row' onClick={() => void Taro.navigateTo({ url: PRIVACY_PAGE })}><Text className='menu-text'>隐私政策</Text><Text className='menu-value'>草案<View className='i-chevron-r' /></Text></View>
    </View>
  </View>;
}
