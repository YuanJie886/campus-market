import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { ApiError, toUserMessage } from '../../api/errors';
import { CIRCLE_MEMBER_LIMIT, type Circle, type CircleInvite, type CircleMember, type CircleMemberPage, type CircleRole, type CircleVisibility } from '../../api/contracts';

const MEMBER_PAGE_SIZE = 20;
import { useAuth } from '../../context/AuthContext';
import { CIRCLE_ROLE_LABEL, CIRCLE_VISIBILITY_LABEL, circleInviteLink } from '../../utils/circle';

const INVITE_STATUS: Record<CircleInvite['status'], string> = { PENDING: '待使用', REDEEMED: '已使用', REVOKED: '已撤销', EXPIRED: '已过期' };
const HOURS = [1, 24, 72, 168];

type Pending = { kind: 'remove' | 'transfer'; member: CircleMember } | { kind: 'archive' } | null;

/**
 * 圈子管理（所有者 / 管理员）。邀请码只在创建后显示这一次，离开页面即消失，不写入任何存储。
 * 成员操作完成后焦点固定回到成员列表标题或原来的操作按钮，不会丢到页面顶部。
 */
export default function CircleManagePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [circle, setCircle] = useState<Circle | null | undefined>(undefined);
  // 6.1C：成员分页（每页 20 人），不一次加载全部成员
  const [memberPage, setMemberPage] = useState<CircleMemberPage>({ items: [], total: 0, page: 1, size: MEMBER_PAGE_SIZE });
  const members: CircleMember[] = memberPage.items;
  const pageCount = Math.max(1, Math.ceil(memberPage.total / memberPage.size));
  const [invites, setInvites] = useState<CircleInvite[]>([]);
  const [hours, setHours] = useState(24);
  const [created, setCreated] = useState<{ token: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [menu, setMenu] = useState<{ anchor: HTMLElement; member: CircleMember } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<CircleVisibility>('PRIVATE');
  const membersHeading = useRef<HTMLHeadingElement>(null);
  const tokenRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await getApiClient().getCircle(id);
      if (!('myRole' in c) || c.myRole === 'MEMBER' || c.status !== 'ACTIVE') { setCircle(null); return }
      setCircle(c);
      setName(c.name);
      setDescription(c.description);
      setVisibility(c.visibility);
      const [m, i] = await Promise.all([getApiClient().listCircleMembers(id, 1, MEMBER_PAGE_SIZE), getApiClient().listCircleInvites(id)]);
      setMemberPage(m);
      setInvites(i);
    } catch (e) {
      if (e instanceof ApiError && e.code === 404) setCircle(null);
      else setError(toUserMessage(e));
    }
  }, [id]);
  useEffect(() => { void load() }, [load]);

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setStatus(done);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const createInvite = () => run(async () => {
    const result = await getApiClient().createCircleInvite(id, hours);
    setCreated({ token: result.token, expiresAt: result.invite.expiresAt });
    setInvites(await getApiClient().listCircleInvites(id));
    window.setTimeout(() => tokenRef.current?.focus(), 0);
  }, '邀请码已生成');

  const revoke = (invite: CircleInvite) => run(async () => {
    await getApiClient().revokeCircleInvite(invite.id);
    setInvites(await getApiClient().listCircleInvites(id));
  }, '邀请码已撤销');

  const changeRole = (member: CircleMember, role: CircleRole) => run(async () => {
    await getApiClient().changeCircleMemberRole(id, member.userId, role);
    setMemberPage(await getApiClient().listCircleMembers(id, memberPage.page, MEMBER_PAGE_SIZE));
    if (role === 'OWNER') await load();
  }, role === 'OWNER' ? `已把所有者转让给 ${member.nickname}` : `已把 ${member.nickname} 设为${CIRCLE_ROLE_LABEL[role]}`);

  const remove = (member: CircleMember) => run(async () => {
    await getApiClient().removeCircleMember(id, member.userId);
    const fresh = await getApiClient().listCircleMembers(id, memberPage.page, MEMBER_PAGE_SIZE);
    // 移除后这一页可能变空：退回上一页
    setMemberPage(fresh.items.length || fresh.page === 1 ? fresh : await getApiClient().listCircleMembers(id, fresh.page - 1, MEMBER_PAGE_SIZE));
    restoreFocus.current = membersHeading.current;
  }, `已移除 ${member.nickname}`);

  const archive = () => run(async () => {
    await getApiClient().archiveCircle(id);
    navigate(`/circles/${encodeURIComponent(id)}`);
  }, '圈子已归档');

  const saveSettings = () => run(async () => {
    const patch: Record<string, string> = {};
    if (name.trim() !== circle?.name) patch.name = name.trim();
    if (description.trim() !== circle?.description) patch.description = description.trim();
    if (circle?.myRole === 'OWNER' && visibility !== circle.visibility) patch.visibility = visibility;
    if (Object.keys(patch).length) setCircle(await getApiClient().updateCircle(id, patch));
  }, '圈子信息已保存');

  const confirmPending = async () => {
    const p = pending;
    if (!p) return;
    if (p.kind === 'remove') await remove(p.member);
    else if (p.kind === 'transfer') await changeRole(p.member, 'OWNER');
    else await archive();
    setPending(null);
  };

  if (circle === undefined && !error) return <p role="status" className="text-sm text-slate-600">正在读取…</p>;
  if (circle === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-xl font-extrabold text-slate-800">圈子不存在或你没有权限管理</h1>
        <Link to="/circles" className="text-sm text-indigo-800 underline">返回我的圈子</Link>
      </div>
    );
  }
  if (!circle) return <Alert severity="error">{error}</Alert>;
  const owner = circle.myRole === 'OWNER';
  const canRemove = (m: CircleMember) => m.userId !== currentUser?.id && m.role !== 'OWNER' && (owner || m.role === 'MEMBER');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800">管理「{circle.name}」</h1>
        <p className="text-xs text-slate-700">我是{CIRCLE_ROLE_LABEL[circle.myRole]}。<Link to={`/circles/${encodeURIComponent(circle.id)}`} className="text-indigo-800 underline">返回圈子</Link></p>
      </div>
      {error && <Alert severity="error">{error}</Alert>}
      <div role="status" aria-live="polite" className="text-sm text-emerald-800">{status}</div>

      <section aria-labelledby="settings-title" className="space-y-2">
        <h2 id="settings-title" className="text-base font-bold text-slate-800">圈子信息</h2>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void saveSettings() }}>
          <TextField label="圈子名称" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth inputProps={{ maxLength: 30 }} />
          <TextField label="简介" value={description} onChange={(e) => setDescription(e.target.value)} size="small" fullWidth multiline minRows={2} inputProps={{ maxLength: 200 }} />
          {owner && (
            <TextField select label="谁能发现这个圈子" value={visibility} onChange={(e) => setVisibility(e.target.value as CircleVisibility)} size="small" fullWidth>
              {(['PRIVATE', 'DISCOVERABLE'] as const).map((v) => <MenuItem key={v} value={v}>{CIRCLE_VISIBILITY_LABEL[v]}</MenuItem>)}
            </TextField>
          )}
          <Button type="submit" variant="outlined" size="small" disabled={busy}>保存圈子信息</Button>
        </form>
      </section>

      <section aria-labelledby="invite-title" className="space-y-2">
        <h2 id="invite-title" className="text-base font-bold text-slate-800">邀请成员</h2>
        <p className="text-xs text-slate-700">每个邀请码只能使用一次。邀请码只在生成后显示这一次，平台不保存原文，丢失后请重新生成。</p>
        <div className="flex flex-wrap items-start gap-2">
          <TextField select size="small" label="有效期" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HOURS.map((h) => <MenuItem key={h} value={h}>{h === 168 ? '7 天' : h === 72 ? '3 天' : `${h} 小时`}</MenuItem>)}
          </TextField>
          <Button variant="contained" onClick={() => void createInvite()} disabled={busy}>生成邀请码</Button>
        </div>
        {created && (
          <div ref={tokenRef} tabIndex={-1} aria-labelledby="created-token-title" className="rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3 outline-none">
            <p id="created-token-title" className="text-sm font-bold text-indigo-900">新邀请码（只显示这一次）</p>
            <p className="mt-1 break-all font-mono text-sm" data-testid="circle-invite-token">{created.token}</p>
            <p className="mt-1 break-all text-xs text-slate-700">邀请链接：{circleInviteLink(window.location.origin, created.token)}</p>
            <p className="mt-1 text-xs text-slate-700">有效期至 {new Date(created.expiresAt).toLocaleString()}</p>
            <Button size="small" onClick={() => setCreated(null)}>我已保存，隐藏邀请码</Button>
          </div>
        )}
        {invites.length > 0 && (
          <ul className="space-y-1 text-sm" aria-label="邀请码记录">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2">
                <span>{new Date(inv.createdAt).toLocaleString()} 生成 · {INVITE_STATUS[inv.status]}</span>
                {inv.status === 'PENDING' && (
                  <Button size="small" color="inherit" onClick={() => void revoke(inv)} disabled={busy}
                    aria-label={`撤销 ${new Date(inv.createdAt).toLocaleString()} 生成的邀请码`}>撤销</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="members-title" className="space-y-2">
        <h2 id="members-title" ref={membersHeading} tabIndex={-1} className="text-base font-bold text-slate-800 outline-none">成员（{memberPage.total}）</h2>
        <ul className="space-y-1" aria-label="成员列表">
          {members.map((m) => {
            const menuItems = owner && m.userId !== currentUser?.id;
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2">
                <span className="text-sm">{m.nickname || '同学'} · {CIRCLE_ROLE_LABEL[m.role]}</span>
                {(menuItems || canRemove(m)) && (
                  <Button size="small" aria-haspopup="menu" aria-label={`管理成员 ${m.nickname || '同学'}`} data-member={m.userId}
                    onClick={(e) => { restoreFocus.current = e.currentTarget; setMenu({ anchor: e.currentTarget, member: m }) }}>
                    操作
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-slate-600">每个圈子最多 {CIRCLE_MEMBER_LIMIT} 名在籍成员（含所有者）。</p>
        {pageCount > 1 && (
          <nav aria-label="成员分页" className="flex items-center gap-2">
            <Button size="small" disabled={memberPage.page <= 1}
              onClick={() => void run(async () => setMemberPage(await getApiClient().listCircleMembers(id, memberPage.page - 1, MEMBER_PAGE_SIZE)), '')}>上一页</Button>
            <span className="text-sm text-slate-700" aria-live="polite">第 {memberPage.page} / {pageCount} 页</span>
            <Button size="small" disabled={memberPage.page >= pageCount}
              onClick={() => void run(async () => setMemberPage(await getApiClient().listCircleMembers(id, memberPage.page + 1, MEMBER_PAGE_SIZE)), '')}>下一页</Button>
          </nav>
        )}
      </section>

      {owner && (
        <section aria-labelledby="archive-title" className="space-y-1">
          <h2 id="archive-title" className="text-base font-bold text-slate-800">归档圈子</h2>
          <p className="text-xs text-slate-700">归档后不能再发布、订阅或邀请；圈子订阅会停用，未使用的邀请码会作废。已经成立的订单不受影响。归档不能撤销。</p>
          <Button color="error" variant="outlined" size="small" onClick={(e) => { restoreFocus.current = e.currentTarget; setPending({ kind: 'archive' }) }}>归档圈子</Button>
        </section>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {menu && owner && menu.member.userId !== currentUser?.id && menu.member.role === 'MEMBER' && (
          <MenuItem onClick={() => { const m = menu.member; setMenu(null); void changeRole(m, 'MODERATOR') }}>设为管理员</MenuItem>
        )}
        {menu && owner && menu.member.role === 'MODERATOR' && (
          <MenuItem onClick={() => { const m = menu.member; setMenu(null); void changeRole(m, 'MEMBER') }}>取消管理员</MenuItem>
        )}
        {menu && owner && menu.member.userId !== currentUser?.id && (
          <MenuItem onClick={() => { const m = menu.member; setMenu(null); setPending({ kind: 'transfer', member: m }) }}>转让所有者</MenuItem>
        )}
        {menu && canRemove(menu.member) && (
          <MenuItem onClick={() => { const m = menu.member; setMenu(null); setPending({ kind: 'remove', member: m }) }}>移出圈子</MenuItem>
        )}
      </Menu>

      <Dialog open={!!pending} onClose={() => setPending(null)} aria-labelledby="manage-confirm-title"
        TransitionProps={{ onExited: () => (restoreFocus.current?.isConnected ? restoreFocus.current : membersHeading.current)?.focus() }}>
        <DialogTitle id="manage-confirm-title">
          {pending?.kind === 'remove' ? `把 ${pending.member.nickname || '同学'} 移出圈子？`
            : pending?.kind === 'transfer' ? `把所有者转让给 ${pending.member.nickname || '同学'}？` : '归档这个圈子？'}
        </DialogTitle>
        <DialogContent>
          <p className="text-sm text-slate-700">
            {pending?.kind === 'remove' ? '对方的圈子订阅将停用，看不到这个圈子里仅圈子可见的商品；已经成立的订单不受影响。'
              : pending?.kind === 'transfer' ? '转让后你会成为管理员，不能再调整成员角色或归档圈子。'
                : '归档不能撤销。'}
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} autoFocus>取消</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void confirmPending()}>确认</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
