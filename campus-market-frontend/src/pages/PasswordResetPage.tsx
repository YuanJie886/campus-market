import { Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../api/client';
import { toUserMessage } from '../api/errors';
import { useAuth } from '../context/AuthContext';
import NewPasswordFields, { newPasswordProblem } from '../components/account/PasswordFields';

// 离线演示专用的「模拟签发重置码」。构建期常量折叠：REST 构建里这个懒加载被整体删掉
const DemoResetCodeIssuer = import.meta.env.VITE_API_MODE === 'mock' ? lazy(() => import('../components/demo/DemoResetCodeIssuer')) : null;

/**
 * 凭学校工作人员签发的重置码找回密码（不需要登录）。
 * 平台没有邮件 / 短信通道：重置码由本校学校管理员线下核对身份后签发（docs/account-lifecycle.md）。
 * 重置码不区分大小写、短横线可省略——由服务端统一处理，这里按用户输入原样提交。
 * 失败时服务端只说「账号或重置码无效或已过期」，不透露账号是否存在，界面原样显示。
 */
export default function PasswordResetPage() {
  const { currentUser, endLocalSession } = useAuth();
  const [account, setAccount] = useState('');
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy) return;
    const local = !account.trim() ? '请输入账号' : !code.trim() ? '请输入重置码' : newPasswordProblem(next, confirm);
    if (local) { setProblem(local); return }
    setProblem(null);
    setBusy(true);
    try {
      await getApiClient().resetPasswordWithCode({ account: account.trim(), code: code.trim(), newPassword: next });
      // 服务端已结束这个账号的全部会话；如果本页正登录着（无论哪个账号），也一并退出，避免留下失效的登录态
      if (currentUser) endLocalSession();
      setDone(true);
      setCode(''); setNext(''); setConfirm('');
    } catch (e) {
      setProblem(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-2 md:py-6">
      <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card md:p-8">
        <h1 className="text-xl font-extrabold text-slate-800">找回密码</h1>
        <div className="mt-2 space-y-1 text-sm text-slate-700">
          <p>平台没有邮件或短信找回。请带上学生证等身份证明联系本校平台工作人员（学校管理员），核对身份后会给你一个一次性重置码。</p>
          <p>重置码格式为 XXXX-XXXX-XXXX，30 分钟内有效，输错 5 次作废；大小写与短横线都可以忽略。重置成功后，所有设备上的登录都会退出。</p>
        </div>
        {done ? (
          <div className="mt-4 space-y-3">
            <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              密码已重置，所有设备上的登录都已退出。请用新密码登录。
            </p>
            <Button component={Link} to="/login" variant="contained" fullWidth>去登录</Button>
          </div>
        ) : (
          <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
            <TextField id="reset-account" label="学号 / 手机号" autoComplete="username" value={account}
              onChange={(e) => setAccount(e.target.value)} fullWidth required />
            <TextField id="reset-code" label="重置码" placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" value={code}
              onChange={(e) => setCode(e.target.value)} inputProps={{ maxLength: 40, spellCheck: false, autoCapitalize: 'characters' }}
              helperText="由学校工作人员当面或线下提供" fullWidth required />
            <NewPasswordFields idPrefix="reset-password" next={next} confirm={confirm} onNext={setNext} onConfirm={setConfirm} />
            {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
            <Button type="submit" variant="contained" size="large" disabled={busy} fullWidth>重置密码</Button>
          </form>
        )}
      </div>
      {DemoResetCodeIssuer && !done && (
        <Suspense fallback={null}>
          <DemoResetCodeIssuer onIssued={(issuedAccount, issuedCode) => { setAccount(issuedAccount); setCode(issuedCode) }} />
        </Suspense>
      )}
      <p className="text-center text-sm text-slate-500">
        想起来了？<Link to="/login" className="ml-1 font-semibold text-brand-600">返回登录</Link>
      </p>
    </div>
  );
}
