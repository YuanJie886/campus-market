import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import StorefrontIcon from "@mui/icons-material/Storefront";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../context/NotificationContext";
import { useSchools } from "../hooks/useSchools";
import { toUserMessage } from '../api/errors';
import { clearPendingInvite } from '../utils/pendingInvite';
import { LegalDialog, LegalLinks, type LegalKind } from '../legal/LegalDocumentView';
import { useClientConfig } from '../hooks/useClientConfig';
import { INVITE_CODE_ALPHABET, INVITE_CODE_INVALID, INVITE_CODE_REQUIRED, formatInviteCodeInput, looksLikeInviteCode, normalizeInviteCode } from '../api/contracts';
import type { RegisterInput } from '../types';
import { inviteCodeFromFragment, stripInviteFragment } from '../utils/registrationInvite';

// 离线演示专用的「演示邀请码」面板。构建期常量折叠：REST 构建里这个懒加载被整体删掉
const DemoInviteCodes = import.meta.env.VITE_API_MODE === 'mock' ? lazy(() => import('../components/demo/DemoInviteCodes')) : null;

/** 未勾选同意时的提示（显示在勾选框下方，并由 role=alert 播报） */
export const CONSENT_REQUIRED = "请先阅读并勾选同意《用户协议》和《隐私政策》";
/** 学校 / 校区没有选择时的提示（显示在对应选择框下方） */
export const SCHOOL_REQUIRED = "请选择学校";
export const CAMPUS_REQUIRED = "请选择所在校区";
/** 邀请制（GET /v1/config 的 registration.inviteRequired=true）时邀请码输入框下方的说明 */
export const INVITE_HELP = "目前为小范围测试，需要学校工作人员发放的邀请码";
/** 格式提示：只提示，不拦截提交（以服务端的判定为准） */
export const INVITE_FORMAT_HINT = "邀请码格式为 XXXX-XXXX-XXXX（12 位大写字母或数字，不含 I、L、O、0、1），请核对";
const INVITE_SERVER_ERRORS: readonly string[] = [INVITE_CODE_REQUIRED, INVITE_CODE_INVALID];

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
  // 学校与校区来自 GET /v1/schools：新用户没有默认校区，必须主动选择；只有一所学校时不显示学校选择
  const { schools, loading: schoolsLoading, error: schoolsError, reload: reloadSchools } = useSchools();
  const [schoolChoice, setSchoolChoice] = useState("");
  const [campus, setCampus] = useState("");
  const [schoolError, setSchoolError] = useState(false);
  const [campusError, setCampusError] = useState(false);
  const singleSchool = schools.length === 1;
  const schoolId = singleSchool ? schools[0].id : schoolChoice;
  const campusOptions = schools.find((s) => s.id === schoolId)?.campuses ?? [];
  const schoolRef = useRef<HTMLInputElement>(null);
  const campusRef = useRef<HTMLInputElement>(null);
  const [contact, setContact] = useState("");
  // 必须由用户主动勾选：不预选，未勾选时不发出注册请求
  const [agreed, setAgreed] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const consentLabelId = useId();
  const consentErrorId = useId();

  // 邀请制：只有服务端配置要求时才显示邀请码并随注册请求提交；服务端回答「请输入邀请码」时（例如配置没有拿到）同样补出输入框
  const { config } = useClientConfig();
  const [serverAskedInvite, setServerAskedInvite] = useState(false);
  const inviteRequired = config.registration.inviteRequired || serverAskedInvite;
  // 邀请链接 /register#invite=CODE：渲染前读出片段预填，挂载后立即从地址栏删掉（片段本来就不会发给服务器）
  const [inviteCode, setInviteCode] = useState(() => (typeof window === "undefined" ? "" : inviteCodeFromFragment(window.location.hash) ?? ""));
  useEffect(() => { stripInviteFragment() }, []);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBlurred, setInviteBlurred] = useState(false);
  const [inviteFocusTick, setInviteFocusTick] = useState(0);
  const inviteRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (inviteFocusTick > 0) inviteRef.current?.focus() }, [inviteFocusTick]);
  const inviteCompact = normalizeInviteCode(inviteCode);
  const inviteFormatHint = inviteCompact !== "" && !looksLikeInviteCode(inviteCode)
    && (inviteBlurred || inviteCompact.length >= 12 || [...inviteCompact].some((ch) => !INVITE_CODE_ALPHABET.includes(ch)));

  const handleRegister = async () => {
    if (busy) return;
    if (inviteRequired && !inviteCompact) {
      setInviteError(INVITE_CODE_REQUIRED);
      setInviteFocusTick((t) => t + 1);
      return;
    }
    if (!schoolId) {
      setSchoolError(true);
      schoolRef.current?.focus();
      return;
    }
    if (!campus || !campusOptions.some((c) => c.id === campus)) {
      setCampusError(true);
      campusRef.current?.focus();
      return;
    }
    if (!agreed) {
      setConsentError(true);
      consentRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (password !== confirm) {
        error("两次输入的密码不一致");
        return;
      }
      const input: RegisterInput = { account, password, nickname, campus, contact };
      // 不需要邀请码时不发送这个字段（服务端也会忽略）
      if (inviteRequired) input.inviteCode = inviteCode.trim();
      const result = await register(input);
      if (result.ok) {
        success(result.message);
        navigate(redirectTo, { replace: true });
      } else {
        clearPendingInvite();
        error(result.message);
        // 服务端的邀请码提示（原文）同时显示在输入框下方，并把焦点移过去
        const inviteProblem = INVITE_SERVER_ERRORS.find((m) => result.message.startsWith(m));
        if (inviteProblem) {
          if (inviteProblem === INVITE_CODE_REQUIRED) setServerAskedInvite(true);
          setInviteError(inviteProblem);
          setInviteFocusTick((t) => t + 1);
        }
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
          {inviteRequired && (
            <TextField
              label="邀请码"
              value={inviteCode}
              onChange={(e) => { setInviteCode(formatInviteCodeInput(e.target.value)); setInviteError(null); setInviteBlurred(false); }}
              onBlur={() => setInviteBlurred(true)}
              fullWidth
              required
              placeholder="XXXX-XXXX-XXXX"
              error={inviteError !== null}
              inputRef={inviteRef}
              inputProps={{ maxLength: 64, autoComplete: "off", autoCapitalize: "characters", spellCheck: false }}
              helperText={
                <>
                  <span className="block">{INVITE_HELP}</span>
                  {inviteError ? (
                    <span role="alert" className="block">{inviteError}</span>
                  ) : inviteFormatHint ? (
                    <span className="block">{INVITE_FORMAT_HINT}</span>
                  ) : null}
                </>
              }
            />
          )}
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
          {schoolsError ? (
            <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              <p>学校列表加载失败：{schoolsError}</p>
              <Button size="small" onClick={reloadSchools} sx={{ mt: 0.5 }}>重新加载</Button>
            </div>
          ) : !schoolsLoading && schools.length === 0 ? (
            <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              暂时没有开放注册的学校，请稍后再来。
            </p>
          ) : (
            <>
              {!singleSchool && (
                <TextField
                  select
                  label="学校"
                  value={schoolChoice}
                  onChange={(e) => {
                    setSchoolChoice(e.target.value);
                    // 换学校后原来的校区一定不属于新学校：清空，让用户重新选择
                    setCampus("");
                    setSchoolError(false);
                  }}
                  fullWidth
                  required
                  disabled={schoolsLoading}
                  error={schoolError}
                  helperText={schoolError ? SCHOOL_REQUIRED : schoolsLoading ? "正在加载学校列表…" : undefined}
                  inputRef={schoolRef}
                >
                  {schools.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                select
                label="所在校区"
                value={campus}
                onChange={(e) => { setCampus(e.target.value); setCampusError(false); }}
                fullWidth
                required
                disabled={schoolsLoading || !schoolId}
                error={campusError}
                helperText={
                  campusError ? CAMPUS_REQUIRED
                    : singleSchool ? `${schools[0].name} · 注册后可在个人资料里改为本校其他校区`
                    : !schoolId ? "请先选择学校" : undefined
                }
                inputRef={campusRef}
              >
                {campusOptions.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
          <TextField
            label="联系方式"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            fullWidth
            helperText="选填，默认使用你的账号"
          />

          <div>
            <div className="flex items-start gap-1">
              <Checkbox
                checked={agreed}
                onChange={(e) => { setAgreed(e.target.checked); if (e.target.checked) setConsentError(false); }}
                inputRef={consentRef}
                inputProps={{
                  "aria-labelledby": consentLabelId,
                  "aria-describedby": consentError ? consentErrorId : undefined,
                  "aria-invalid": consentError,
                  "aria-required": true,
                }}
                sx={{ mt: -0.75, ml: -1.25 }}
              />
              {/* 可访问名称是整句「已阅读并同意《用户协议》《隐私政策》」；两个链接在本页弹窗里打开，已填写的内容不丢 */}
              <p id={consentLabelId} className="text-sm leading-6 text-slate-700">
                已阅读并同意<LegalLinks onOpen={setLegal} />
              </p>
            </div>
            {consentError && (
              <p id={consentErrorId} role="alert" className="ml-8 text-xs text-red-700">
                {CONSENT_REQUIRED}
              </p>
            )}
          </div>

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

      {DemoInviteCodes && (
        <Suspense fallback={null}>
          <DemoInviteCodes onPick={(code) => { setInviteCode(formatInviteCodeInput(code)); setInviteError(null); }} />
        </Suspense>
      )}
      <p className="text-center text-sm text-slate-500">
        已有账号？
        <Link to="/login" className="ml-1 font-semibold text-brand-600">
          去登录
        </Link>
      </p>
      <LegalDialog kind={legal} onClose={() => setLegal(null)} />
    </div>
  );
}
