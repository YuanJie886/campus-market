import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import { ACCOUNT_DELETION_CONFIRMATION } from '../../api/contracts';
import { useAuth } from '../../context/AuthContext';
import { useNotify } from '../../context/NotificationContext';
import NewPasswordFields, { newPasswordProblem } from '../../components/account/PasswordFields';

/** 注销会发生什么：与后端 AccountService.deleteAccount 同一事务里的收尾一一对应（docs/account-lifecycle.md 第 3 节） */
export const DELETION_CONSEQUENCES: readonly string[] = [
  '你在售的商品全部下架；你所有商品上的联系方式被清除，并取消「公开展示联系方式」。',
  '你发出、还在等待的联系申请自动撤回；你收到、还没处理的申请自动拒绝；你已经同意的申请撤回同意，对方立即看不到你的联系方式。',
  '你退出加入的所有圈子；需求订阅停用；你发出的协助整理邀请撤销；微信绑定解除。',
  '你上传的图片全部删除，已经发出的图片地址同时失效。',
  '所有设备上的登录全部结束；昵称改为「已注销用户」，头像、联系方式与宿舍楼清空。原账号名之后可以重新注册，但那是一个新账号，不会恢复任何内容。',
];
/** 注销后仍然保留的记录（合规、申诉与对方的历史记录需要） */
export const DELETION_RETAINED =
  '仍然保留：已售出商品的标题与描述、你发出的留言与私信正文（对方的历史记录）、治理案件、举报、处理与限制记录。这些记录里你显示为「已注销用户」。';

function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setDone(null);
    const local = !current ? '请输入当前密码' : newPasswordProblem(next, confirm);
    if (local) { setProblem(local); return }
    setProblem(null);
    setBusy(true);
    try {
      const result = await getApiClient().changePassword({ currentPassword: current, newPassword: next });
      setCurrent(''); setNext(''); setConfirm('');
      setDone(result.otherSessionsEnded > 0
        ? `密码已修改。你在其他设备上的 ${result.otherSessionsEnded} 个登录已全部退出，需要用新密码重新登录；这台设备保持登录。`
        : '密码已修改。其他设备上的登录（如果有）已全部退出，需要用新密码重新登录；这台设备保持登录。');
    } catch (e) {
      // 400（当前密码不正确、新旧密码相同……）、401、429 原样显示服务端的话
      setProblem(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="change-password-title" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-6">
      <h2 id="change-password-title" className="text-base font-bold text-slate-800">修改密码</h2>
      <p className="mt-1 text-xs text-slate-600">修改成功后，你在其他设备上的登录会全部退出；当前这台设备保持登录。</p>
      <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
        <TextField id="change-password-current" label="当前密码" type="password" autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)} fullWidth required />
        <NewPasswordFields idPrefix="change-password" next={next} confirm={confirm} onNext={setNext} onConfirm={setConfirm} />
        {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
        <p role="status" aria-live="polite" className="text-sm text-emerald-800">{done ?? ''}</p>
        <div className="flex justify-end">
          <Button type="submit" variant="contained" disabled={busy}>修改密码</Button>
        </div>
      </form>
    </section>
  );
}

function DeleteAccountSection() {
  const navigate = useNavigate();
  const { endLocalSession } = useAuth();
  const { success } = useNotify();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = confirmation === ACCOUNT_DELETION_CONFIRMATION && password.length > 0;

  const submit = async () => {
    if (busy || !ready) return;
    setProblem(null);
    setBusy(true);
    try {
      await getApiClient().deleteAccount({ password, confirmation });
      // 服务端已结束全部会话：只清本页内存里的登录态，然后回到首页
      endLocalSession();
      success('账号已注销，所有设备上的登录都已退出');
      navigate('/', { replace: true });
    } catch (e) {
      // 400（密码不正确、确认语不对）、409（仍有后台权限 / 仍是在用圈子的所有者）、429 原样显示
      setProblem(toUserMessage(e));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="delete-account-title" className="rounded-2xl border border-red-100 bg-white p-4 shadow-card md:p-6">
      <h2 id="delete-account-title" className="text-base font-bold text-red-800">注销账号</h2>
      <p className="mt-1 text-sm text-slate-700">注销不能撤销。注销后会立即发生：</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {DELETION_CONSEQUENCES.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="mt-2 text-sm text-slate-700">{DELETION_RETAINED}</p>
      <p className="mt-2 text-sm text-slate-700">
        如果你仍是平台工作人员，需要先请学校管理员停用后台权限；如果你仍是某个圈子的所有者，需要先移交所有者或归档圈子。
      </p>
      <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
        <TextField id="delete-account-password" label="当前密码" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} fullWidth required />
        <TextField id="delete-account-confirmation" label={`请输入「${ACCOUNT_DELETION_CONFIRMATION}」`} value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)} fullWidth required autoComplete="off"
          helperText={`逐字输入「${ACCOUNT_DELETION_CONFIRMATION}」四个字后才能提交`} />
        {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="contained" color="error" disabled={busy || !ready}>注销账号</Button>
        </div>
      </form>
    </section>
  );
}

/** 个人中心 → 账号与安全：修改密码、注销账号 */
export default function AccountSecurityPage() {
  return (
    <div className="flex flex-col gap-4">
      <ChangePasswordSection />
      <DeleteAccountSection />
    </div>
  );
}
