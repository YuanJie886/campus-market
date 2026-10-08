import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import StorefrontIcon from "@mui/icons-material/Storefront";
import BoltIcon from "@mui/icons-material/Bolt";
import { useAuth, DEMO_ACCOUNT, DEMO_PASSWORD } from "../context/AuthContext";
import { useNotify } from "../context/NotificationContext";
import { toUserMessage } from '../api/errors';
import { clearPendingInvite, hasPendingInvite } from '../utils/pendingInvite';

interface LocationState {
  from?: string;
}

/** 登录页 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, demoLogin } = useAuth();
  const { success, error } = useNotify();

  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");

  const redirectTo = (location.state as LocationState | null)?.from ?? "/";

  const handleLogin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await login(account, password);
      if (result.ok) {
        success(result.message);
        navigate(redirectTo, { replace: true });
      } else {
        inviteLost();
        error(result.message);
      }
    } catch (e) {
      inviteLost();
      error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // 6.1B：登录失败时清除内存里的圈子邀请码（安全取舍），并如实告诉用户
  const [inviteDropped, setInviteDropped] = useState(false);
  const inviteLost = () => {
    if (!hasPendingInvite()) return;
    clearPendingInvite();
    setInviteDropped(true);
  };

  const handleDemo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await demoLogin();
      if (result.ok) {
        success("已使用体验账号登录");
        navigate(redirectTo, { replace: true });
      } else {
        error(result.message);
      }
    } catch (e) {
      error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-2 md:py-6">
      <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card md:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/25">
            <StorefrontIcon />
          </span>
          <h1 className="mt-3 text-xl font-extrabold text-slate-800">
            欢迎回到校园集市
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            用学号或手机号登录，继续淘好物
          </p>
        </div>

        {hasPendingInvite() && !inviteDropped && (
          <p className="mb-4 rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-900" role="note">
            登录后会回到圈子邀请页，由你确认是否加入。邀请码只保存在这个页面里，刷新页面会丢失。
          </p>
        )}
        {inviteDropped && (
          <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
            登录没有成功，为了安全，刚才的圈子邀请码已清除。登录后请重新打开邀请链接，或手动输入邀请码。
          </p>
        )}

        <div className="flex flex-col gap-4">
          <TextField
            label="学号 / 手机号"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            fullWidth
            autoComplete="username"
          />
          <TextField
            label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
          />

          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleLogin}
            disabled={busy}
          >
            登录
          </Button>

          {import.meta.env.VITE_API_MODE === "mock" && (
            <Button
              variant="outlined"
              size="large"
              fullWidth
              startIcon={<BoltIcon />}
              onClick={handleDemo}
              disabled={busy}
            >
              一键体验账号
            </Button>
          )}

          {import.meta.env.VITE_API_MODE === "mock" && (
            <div className="rounded-xl bg-brand-50 px-3 py-2.5 text-xs leading-5 text-brand-800">
              演示账号：<b>{DEMO_ACCOUNT}</b> ／ 密码：<b>{DEMO_PASSWORD}</b>
              <br />
              点击「一键体验账号」即可自动登录，无需手动输入。
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-sm text-slate-500">
        还没有账号？
        <Link to="/register" state={{ from: redirectTo }} className="ml-1 font-semibold text-brand-600">
          立即注册
        </Link>
      </p>
    </div>
  );
}
