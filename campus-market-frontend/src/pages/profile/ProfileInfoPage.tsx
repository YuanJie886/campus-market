import { Suspense, lazy, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "@mui/material/Avatar";
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
import { toUserMessage } from '../../api/errors';

const AVATAR_PRESETS = Array.from(
  { length: 8 },
  (_, i) => `https://picsum.photos/seed/cm-face-${i + 1}/200/200`,
);

/** 个人资料编辑页 */
export default function ProfileInfoPage() {
  const navigate = useNavigate();
  const { currentUser, updateProfile, logout } = useAuth();
  const { resetDemoData } = useMarket();
  const { success, error, info } = useNotify();

  const [busy, setBusy] = useState(false);
  const [nickname, setNickname] = useState(currentUser?.nickname ?? "");
  const [campus, setCampus] = useState<Campus>(currentUser?.campus ?? "东校区");
  const [contact, setContact] = useState(currentUser?.contact ?? "");
  const [avatar, setAvatar] = useState(currentUser?.avatar ?? "");
  const [dormBuildingId, setDormBuildingId] = useState<string | null>(
    currentUser?.dormBuildingId ?? null,
  );

  useEffect(() => {
    if (currentUser) {
      setNickname(currentUser.nickname);
      setCampus(currentUser.campus);
      setContact(currentUser.contact);
      setAvatar(currentUser.avatar);
      setDormBuildingId(currentUser.dormBuildingId ?? null);
    }
  }, [currentUser]);

  if (!currentUser) {
    return null;
  }

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
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
        avatar,
        // 显式传 null 表示清空：不填宿舍楼是完全正当的选择
        dormBuildingId,
      });
      success("资料已更新");
    } catch (e) {
      error(toUserMessage(e));
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

        {/* 头像选择 */}
        <div className="mb-4">
          <p className="mb-2 text-sm font-semibold text-slate-600">选择头像</p>
          <div className="flex flex-wrap gap-3">
            {AVATAR_PRESETS.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setAvatar(url)}
                className={`overflow-hidden rounded-full border-2 transition ${
                  avatar === url
                    ? "border-brand-500 ring-2 ring-brand-200"
                    : "border-transparent opacity-75 hover:opacity-100"
                }`}
                aria-label="选择头像"
              >
                <Avatar src={url} sx={{ width: 52, height: 52 }} />
              </button>
            ))}
          </div>
        </div>

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

        <div className="mt-5 flex justify-end">
          <Button
            variant="contained"
            size="large"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={busy}
          >
            保存修改
          </Button>
        </div>
      </div>

      {/* 账户管理 */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-6">
        <h2 className="text-base font-bold text-slate-800">账户管理</h2>
        <p className="mt-1 text-xs text-slate-400">
          资料和交易记录保存在服务端，退出登录后可在其他设备继续使用。
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
