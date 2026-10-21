import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../../api';
import { ApiError } from '../../../api/transport';
import { Empty, LoginGate, PageTitle } from '../../../components';
import { CIRCLE_MEMBER_LIMIT, type Circle, type CircleInvite, type CircleMember, type CircleMemberPage, type CircleVisibility } from '../../../model';
import { ARCHIVE_CONFIRM, ARCHIVE_HELP, CIRCLE_ROLE_LABEL, CIRCLE_VISIBILITIES, CIRCLE_VISIBILITY_LABEL, INVITE_HOURS, INVITE_ONCE_TEXT, INVITE_STATUS, MEMBER_ACTION_LABEL, NOT_MANAGER_TITLE, circlePatch, hoursLabel, memberActions, removeConfirm, transferConfirm, type MemberAction } from '../../../circles';
import { formatDateTime } from '../../../governance';
import { CIRCLE_PAGES } from '../../../menu';
import { useMarket } from '../../../state';
import { Avatar } from '../../../widgets/Avatar';
import { InviteCodeBox } from '../../../widgets/InviteCodeBox';

const PAGE_SIZE = 20;

/** 圈子管理（所有者 / 管理员）：圈子信息、邀请码（只显示一次）、成员分页、成员操作与归档，规则与 Web 管理页一致。 */
export default function CircleManagePage() {
  const { user } = useMarket(), id = useRouter().params.id ?? '';
  const [circle, setCircle] = useState<Circle | null | undefined>(undefined), [members, setMembers] = useState<CircleMemberPage>({ items: [], total: 0, page: 1, size: PAGE_SIZE });
  const [invites, setInvites] = useState<CircleInvite[]>([]), [hours, setHours] = useState(24), [created, setCreated] = useState<{ token: string; expiresAt: number } | null>(null);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [visibility, setVisibility] = useState<CircleVisibility>('PRIVATE');
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const load = async () => {
    if (!user) return;
    try {
      const c = await api.circle(id);
      if (!('myRole' in c) || c.myRole === 'MEMBER' || c.status !== 'ACTIVE') { setCircle(null); return; }
      setCircle(c); setName(c.name); setDescription(c.description); setVisibility(c.visibility);
      const [m, i] = await Promise.all([api.circleMembers(id, 1, PAGE_SIZE), api.circleInvites(id)]);
      setMembers(m); setInvites(i);
    } catch (e) { if (e instanceof ApiError && e.code === 404) setCircle(null); else setError(e instanceof Error ? e.message : '加载失败'); }
  };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  const run = async (action: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); setStatus(done); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); } finally { setBusy(false); }
  };
  const goPage = (page: number) => run(async () => setMembers(await api.circleMembers(id, page, PAGE_SIZE)), '');
  const save = () => run(async () => { if (!circle) return; const patch = circlePatch(circle, { name, description, visibility }); if (Object.keys(patch).length) setCircle(await api.updateCircle(id, patch)); }, '圈子信息已保存');
  const createInvite = () => run(async () => { const r = await api.createCircleInvite(id, hours); setCreated({ token: r.token, expiresAt: r.invite.expiresAt }); setInvites(await api.circleInvites(id)); }, '邀请码已生成');
  const revoke = (invite: CircleInvite) => run(async () => { await api.revokeCircleInvite(invite.id); setInvites(await api.circleInvites(id)); }, '邀请码已撤销');
  const act = async (m: CircleMember, action: MemberAction) => {
    const label = m.nickname || '同学';
    if (action === 'remove' || action === 'transfer') {
      const text = action === 'remove' ? removeConfirm(m.nickname) : transferConfirm(m.nickname);
      const answer = await Taro.showModal({ title: text.title, content: text.content, confirmText: '确认', confirmColor: '#b4432f' });
      if (!answer.confirm) return;
    }
    if (action === 'remove') return run(async () => {
      await api.removeCircleMember(id, m.userId);
      const fresh = await api.circleMembers(id, members.page, PAGE_SIZE);
      // 移除后这一页可能变空：退回上一页
      setMembers(fresh.items.length || fresh.page === 1 ? fresh : await api.circleMembers(id, fresh.page - 1, PAGE_SIZE));
    }, `已移除 ${label}`);
    const role = action === 'promote' ? 'MODERATOR' : action === 'demote' ? 'MEMBER' : 'OWNER';
    return run(async () => {
      await api.changeCircleMemberRole(id, m.userId, role);
      setMembers(await api.circleMembers(id, members.page, PAGE_SIZE));
      if (role === 'OWNER') await load();
    }, role === 'OWNER' ? `已把所有者转让给 ${label}` : `已把 ${label} 设为${CIRCLE_ROLE_LABEL[role]}`);
  };
  const menu = async (m: CircleMember) => {
    if (!circle || !user) return;
    const actions = memberActions(circle.myRole, user.id, m);
    if (!actions.length) return;
    try { const { tapIndex } = await Taro.showActionSheet({ itemList: actions.map((a) => MEMBER_ACTION_LABEL[a]) }); await act(m, actions[tapIndex]); } catch { /* 取消 */ }
  };
  const archive = async () => {
    const answer = await Taro.showModal({ title: ARCHIVE_CONFIRM.title, content: ARCHIVE_CONFIRM.content, confirmText: '确认', confirmColor: '#b4432f' });
    if (answer.confirm) await run(async () => { await api.archiveCircle(id); void Taro.navigateBack(); }, '圈子已归档');
  };
  const pages = Math.max(1, Math.ceil(members.total / members.size));
  const owner = circle?.myRole === 'OWNER';
  return <View className='page'>
    <LoginGate returnTo={`${CIRCLE_PAGES.manage}?id=${encodeURIComponent(id)}`}>
      {circle === undefined && !error ? <Empty title='正在读取…' /> : circle === null ? <PageTitle title={NOT_MANAGER_TITLE} /> : !circle ? <Text className='error-text'>{error}</Text> : <>
        <PageTitle title={`管理「${circle.name}」`} subtitle={`我是${CIRCLE_ROLE_LABEL[circle.myRole]}。`} />
        {error ? <Text className='error-text'>{error}</Text> : null}
        {status ? <Text className='notice sheet-line'>{status}</Text> : null}
        <View className='form-card'>
          <Text className='section-title'>圈子信息</Text>
          <Text className='field-label'>圈子名称</Text>
          <Input className='field-input' value={name} maxlength={30} onInput={(e) => setName(e.detail.value)} />
          <Text className='field-label'>简介</Text>
          <Textarea className='field-textarea' value={description} maxlength={200} onInput={(e) => setDescription(e.detail.value)} />
          {owner && <><Text className='field-label'>谁能发现这个圈子</Text>
            {CIRCLE_VISIBILITIES.map((v) => <Text key={v} className={`choice block ${visibility === v ? 'active' : ''}`} onClick={() => setVisibility(v)}>{CIRCLE_VISIBILITY_LABEL[v]}</Text>)}</>}
          <Button className='secondary small mt-12' disabled={busy} onClick={() => void save()}>保存圈子信息</Button>
        </View>
        <View className='form-card'>
          <Text className='section-title'>邀请成员</Text>
          <Text className='field-help'>{INVITE_ONCE_TEXT}</Text>
          <View className='inline-row'>
            <Picker range={INVITE_HOURS.map(hoursLabel)} value={INVITE_HOURS.indexOf(hours)} onChange={(e) => setHours(INVITE_HOURS[Number(e.detail.value)])}>
              <View className='picker'><Text className='picker-value'>有效期：{hoursLabel(hours)}</Text><View className='i-chevron' /></View>
            </Picker>
            <Button className='primary small' disabled={busy} onClick={() => void createInvite()}>生成邀请码</Button>
          </View>
          {created && <InviteCodeBox title='新邀请码（只显示这一次）' token={created.token} note={`有效期至 ${formatDateTime(created.expiresAt)}。对方在「我的 → 我的圈子 → 用邀请码加入」里输入。`} onHide={() => setCreated(null)} />}
          {invites.map((inv) => <View key={inv.id} className='menu-row'>
            <Text className='menu-text'>{formatDateTime(inv.createdAt)} 生成 · {INVITE_STATUS[inv.status]}</Text>
            {inv.status === 'PENDING' && <Text className='text-action' onClick={() => void revoke(inv)}>撤销</Text>}
          </View>)}
        </View>
        <View className='form-card'>
          <Text className='section-title'>成员（{members.total}）</Text>
          {members.items.map((m) => {
            const actions = user ? memberActions(circle.myRole, user.id, m) : [];
            return <View key={m.userId} className='member-row'>
              <Avatar value={m.avatar} userId={m.userId} nickname={m.nickname} size='small' />
              <Text className='menu-text'>{m.nickname || '同学'} · {CIRCLE_ROLE_LABEL[m.role]}</Text>
              {actions.length > 0 && <Text className='text-action' onClick={() => void menu(m)}>操作</Text>}
            </View>;
          })}
          <Text className='field-help'>每个圈子最多 {CIRCLE_MEMBER_LIMIT} 名在籍成员（含所有者）。</Text>
          {pages > 1 && <View className='button-row'>
            <Button className='secondary small' disabled={members.page <= 1 || busy} onClick={() => void goPage(members.page - 1)}>上一页</Button>
            <Text className='muted'>第 {members.page} / {pages} 页</Text>
            <Button className='secondary small' disabled={members.page >= pages || busy} onClick={() => void goPage(members.page + 1)}>下一页</Button>
          </View>}
        </View>
        {owner && <View className='form-card'>
          <Text className='section-title'>归档圈子</Text>
          <Text className='field-help'>{ARCHIVE_HELP}</Text>
          <Button className='danger-button small' disabled={busy} onClick={() => void archive()}>归档圈子</Button>
        </View>}
      </>}
    </LoginGate>
  </View>;
}
