import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import LogoutIcon from "@mui/icons-material/Logout";
import SaveIcon from "@mui/icons-material/Save";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

// 模块 7：离线演示专用的「设为工作人员」开关。构建期常量折叠：REST 构建里这个懒加载被整体删掉
const DemoStaffSwitch = import.meta.env.VITE_API_MODE === "mock" ? lazy(() => import("../../components/demo/DemoStaffSwitch")) : null;
import { useAuth } from "../../context/AuthContext";
import { useMarket } from "../../context/MarketContext";
import { useNotify } from "../../context/NotificationContext";
import { CAMPUSES } from "../../types";
import type { Campus } from "../../types";
import { formatDate, isValidPhone, isValidStudentId } from "../../utils/format";
import BuildingSelect from "../../components/BuildingSelect";
import { ApiError, toUserMessage } from '../../api/errors';
import { getApiClient } from "../../api/client";
import Avatar from "../../components/Avatar";
import { useClientConfig } from "../../hooks/useClientConfig";
import { AVATAR_PRESET_COUNT, isPresetAvatar, normalizeAvatarValue, presetAvatarValue } from "../../utils/avatar";
import { displaySrcOf, imageBytesText, imageFileProblem, imageTooLargeText, imageTypesText, rememberUploadedImage } from "../../utils/images";

/** 保存的头像若是上传图片或外部链接（不是预设、不是空、不是旧演示数据），返回它；否则 "" */
function customOf(stored: string | null | undefined): string {
  const value = normalizeAvatarValue(stored);
  return value && !isPresetAvatar(value) ? value : "";
}

const PRESET_VALUES = Array.from({ length: AVATAR_PRESET_COUNT }, (_, i) => presetAvatarValue(i + 1));

/** 个人资料编辑页 */
export default function ProfileInfoPage() {
  const navigate = useNavigate();
  const { currentUser, updateProfile, logout } = useAuth();
  const { resetDemoData } = useMarket();
  const { success, error, info } = useNotify();

  const [busy, setBusy] = useState(false);
  // 保存失败时服务端的原话（例如昵称被内容安全拦截）显示在保存按钮旁
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nickname, setNickname] = useState(currentUser?.nickname ?? "");
  const [campus, setCampus] = useState<Campus>(currentUser?.campus ?? "东校区");
  const [contact, setContact] = useState(currentUser?.contact ?? "");
  // 头像：旧演示数据里的外部头像按「不使用头像」处理；只有与当前保存的值不同时才提交
  const [avatar, setAvatar] = useState(normalizeAvatarValue(currentUser?.avatar));
  // 「自定义头像」选项：刚上传的图片，或当前保存的上传 / 外部头像（改选预设后仍可改回）
  const [customValue, setCustomValue] = useState(() => customOf(currentUser?.avatar));
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarStatus, setAvatarStatus] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  const avatarHelpId = useId();
  const { config } = useClientConfig();
  const imageRules = config.images;
  const [dormBuildingId, setDormBuildingId] = useState<string | null>(
    currentUser?.dormBuildingId ?? null,
  );

  useEffect(() => {
    if (currentUser) {
      setNickname(currentUser.nickname);
      setCampus(currentUser.campus);
      setContact(currentUser.contact);
      setAvatar(normalizeAvatarValue(currentUser.avatar));
      setCustomValue(customOf(currentUser.avatar));
      setDormBuildingId(currentUser.dormBuildingId ?? null);
    }
  }, [currentUser]);

  if (!currentUser) {
    return null;
  }

  const storedAvatar = currentUser.avatar ?? "";

  const handleAvatarFile = async (files: FileList | null) => {
    const file = files?.[0];
    // 允许再次选择同一个文件（例如失败后重试）
    if (avatarInput.current) avatarInput.current.value = "";
    if (!file) return;
    const problem = imageFileProblem(file, imageRules);
    if (problem) {
      setAvatarError(problem);
      setAvatarStatus("");
      return;
    }
    setAvatarError(null);
    setAvatarUploading(true);
    setAvatarStatus("头像上传中…");
    try {
      const result = await getApiClient().uploadImage(file);
      rememberUploadedImage(result.ref, result.url);
      // 提交服务端返回的上传引用 upload:<id>；签名地址只用于预览
      setAvatar(result.ref);
      setCustomValue(result.ref);
      setAvatarStatus("头像已上传，保存修改后生效");
    } catch (e) {
      const message = e instanceof ApiError && (e.httpStatus === 413 || e.code === 413)
        ? imageTooLargeText(imageRules.maxBytes)
        : toUserMessage(e, "上传失败，请重试");
      setAvatarError(message);
      setAvatarStatus("");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    if (busy || avatarUploading) return;
    setBusy(true);
    setSaveError(null);
    try {
      const name = nickname.trim();
      if (!name) {
        error("昵称不能为空");
        return;
      }
      if (name.length > 16) {
        error("昵称最多 16 个字");
        return;
      }
      const contactValue = contact.trim();
      if (
        contactValue &&
        !isValidPhone(contactValue) &&
        !isValidStudentId(contactValue)
      ) {
        error("联系方式需为有效手机号或学号");
        return;
      }
      await updateProfile({
        nickname: name,
        campus,
        contact: contactValue || currentUser.account,
        // 头像只在改动时提交：未改动的旧外部头像不会因为保存其他字段而被拒绝
        ...(avatar !== storedAvatar ? { avatar } : {}),
        // 显式传 null 表示清空：不填宿舍楼是完全正当的选择
        dormBuildingId,
      });
      success("资料已更新");
    } catch (e) {
      const message = toUserMessage(e);
      setSaveError(message);
      error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = () => {
    resetDemoData();
  };

  const handleLogout = async () => {
    try {
      await logout();
      success("已退出登录");
      navigate("/");
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-6">
        <h2 className="text-base font-bold text-slate-800">编辑个人资料</h2>
        <p className="mt-1 text-xs text-slate-400">
          注册时间：{formatDate(currentUser.createdAt)}
        </p>

        <Divider sx={{ my: 3 }} />

        {/* 头像：12 个本地绘制的预设、上传图片、不使用头像 */}
        <fieldset className="mb-4" aria-describedby={avatarHelpId}>
          <legend className="mb-2 text-sm font-semibold text-slate-600">选择头像</legend>
          <p id={avatarHelpId} className="mb-2 text-xs text-slate-500">
            预设头像在本地绘制，不向任何第三方请求；也可以上传 {imageTypesText(imageRules.accept)} 图片（不超过 {imageBytesText(imageRules.maxBytes)}）。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {PRESET_VALUES.map((value, i) => (
              <label key={value} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="avatar-choice"
                  value={value}
                  checked={avatar === value}
                  onChange={() => setAvatar(value)}
                  aria-label={`预设头像 ${i + 1}`}
                  className="peer sr-only"
                />
                <Avatar
                  avatar={value}
                  nickname={nickname}
                  size={48}
                  className="border-2 border-transparent opacity-80 transition hover:opacity-100 peer-checked:border-brand-500 peer-checked:opacity-100 peer-checked:ring-2 peer-checked:ring-brand-200 peer-focus-visible:ring-2 peer-focus-visible:ring-slate-500"
                />
              </label>
            ))}
            {customValue && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="avatar-choice"
                  value={customValue}
                  checked={avatar === customValue}
                  onChange={() => setAvatar(customValue)}
                />
                <Avatar avatar={displaySrcOf(customValue) ?? ""} nickname={nickname} userId={currentUser.id} size={48} />
                自定义头像
              </label>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="avatar-choice"
                value=""
                checked={avatar === ""}
                onChange={() => setAvatar("")}
              />
              <Avatar avatar="" nickname={nickname} userId={currentUser.id} size={32} />
              不使用头像
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="avatar-upload" className="text-sm text-slate-700">上传头像</label>
            <input
              id="avatar-upload"
              ref={avatarInput}
              type="file"
              accept={imageRules.accept.join(",")}
              disabled={avatarUploading}
              aria-describedby={avatarHelpId}
              onChange={(e) => void handleAvatarFile(e.target.files)}
              className="text-sm"
            />
          </div>
          <p className="mt-1 text-xs text-slate-600" aria-live="polite">{avatarStatus}</p>
          {avatarError && <p role="alert" className="mt-1 text-xs text-red-700">{avatarError}</p>}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TextField
            label="昵称"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            fullWidth
            inputProps={{ maxLength: 16 }}
          />
          <TextField
            label="学号 / 手机号（不可修改）"
            value={currentUser.account}
            fullWidth
            disabled
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
            helperText="手机号或学号，仅交易对方可见"
          />
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700" id="dorm-building-label">
              宿舍楼（选填）
            </p>
            <BuildingSelect
              campus={campus}
              value={dormBuildingId}
              onChange={setDormBuildingId}
              emptyLabel="不填写"
              zoneLabel="宿舍园区"
              buildingLabel="宿舍楼"
              helperText="只保存楼栋，不收集房间号、楼层或床位"
            />
            <p className="mt-2 text-xs text-slate-500">
              只有你自己能看到这条信息。它用于「只看本楼」与距离估算，
              不会出现在你的商品、留言或聊天里。
            </p>
          </div>
        </div>

        {saveError && (
          <p role="alert" className="mt-4 text-sm text-red-700">{saveError}</p>
        )}
        <div className="mt-5 flex justify-end">
          <Button
            variant="contained"
            size="large"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={busy || avatarUploading}
          >
            保存修改
          </Button>
        </div>
      </div>

      {/* 账户管理 */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-6">
        <h2 className="text-base font-bold text-slate-800">账户管理</h2>
        <p className="mt-1 text-xs text-slate-400">
          资料和发布记录保存在服务端，退出登录后可在其他设备继续使用。修改密码与注销账号在「账号与安全」。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {import.meta.env.VITE_API_MODE === "mock" && (
            <Button
              variant="outlined"
              color="warning"
              startIcon={<RestartAltIcon />}
              onClick={handleReset}
            >
              重置演示数据
            </Button>
          )}
          <Button
            variant="outlined"
            color="error"
            startIcon={<LogoutIcon />}
            onClick={handleLogout}
          >
            退出登录
          </Button>
        </div>
        {DemoStaffSwitch && (
          <div className="mt-4">
            <Suspense fallback={null}><DemoStaffSwitch /></Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
