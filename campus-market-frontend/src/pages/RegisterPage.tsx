import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import StorefrontIcon from "@mui/icons-material/Storefront";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../context/NotificationContext";
import { CAMPUSES } from "../types";
import type { Campus } from "../types";
import { toUserMessage } from '../api/errors';
import { clearPendingInvite } from '../utils/pendingInvite';

/** 注册页 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 6.1B：从圈子邀请页进入登录 / 注册时，注册成功后回到邀请页（邀请码仍在本页内存里）
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";
  const { register } = useAuth();
  const { success, error } = useNotify();

  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [campus, setCampus] = useState<Campus>("东校区");
  const [contact, setContact] = useState("");

  const handleRegister = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (password !== confirm) {
        error("两次输入的密码不一致");
        return;
      }
      const result = await register({
        account,
        password,
        nickname,
        campus,
        contact,
      });
      if (result.ok) {
        success(result.message);
        navigate(redirectTo, { replace: true });
      } else {
        clearPendingInvite();
        error(result.message);
      }
    } catch (e) {
      clearPendingInvite();
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
            注册新账号
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            加入校园集市，闲置不再吃灰
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <TextField
            label="学号 / 手机号"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            fullWidth
            required
            helperText="6-20 位数字或字母，或 11 位手机号"
          />
          <TextField
            label="昵称"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            required
            helperText="至少 8 位"
          />
          <TextField
            label="确认密码"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            fullWidth
            required
          />
          <TextField
            select
            label="所在校区"
            value={campus}
            onChange={(e) => setCampus(e.target.value as Campus)}
            fullWidth
          >
            {CAMPUSES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="联系方式"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            fullWidth
            helperText="选填，默认使用你的账号"
          />

          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={handleRegister}
            disabled={busy}
          >
            注册并登录
          </Button>
        </div>
      </div>

      <p className="text-center text-sm text-slate-500">
        已有账号？
        <Link to="/login" className="ml-1 font-semibold text-brand-600">
          去登录
        </Link>
      </p>
    </div>
  );
}
