import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import LogoutIcon from '@mui/icons-material/Logout';
import SaveIcon from '@mui/icons-material/Save';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useAuth } from '../../context/AuthContext';
import { useMarket } from '../../context/MarketContext';
import { useNotify } from '../../context/NotificationContext';
import { CAMPUSES } from '../../types';
import type { Campus } from '../../types';
import { formatDate, isValidPhone, isValidStudentId } from '../../utils/format';

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

  const [nickname, setNickname] = useState(currentUser?.nickname ?? '');
  const [campus, setCampus] = useState<Campus>(currentUser?.campus ?? '东校区');
  const [contact, setContact] = useState(currentUser?.contact ?? '');
  const [avatar, setAvatar] = useState(currentUser?.avatar ?? '');

  useEffect(() => {
    if (currentUser) {
      setNickname(currentUser.nickname);
      setCampus(currentUser.campus);
      setContact(currentUser.contact);
      setAvatar(currentUser.avatar);
    }
  }, [currentUser]);

  if (!currentUser) {
    return null;
  }

  const handleSave = () => {
    const name = nickname.trim();
    if (!name) {
      error('昵称不能为空');
      return;
    }
    if (name.length > 16) {
      error('昵称最多 16 个字');
      return;
    }
    const contactValue = contact.trim();
    if (
      contactValue &&
      !isValidPhone(contactValue) &&
      !isValidStudentId(contactValue)
    ) {
      error('联系方式需为有效手机号或学号');
      return;
    }
    updateProfile({
      nickname: name,
      campus,
      contact: contactValue || currentUser.account,
      avatar,
    });
    success('资料已更新');
  };

  const handleReset = () => {
    resetDemoData();
    info('演示数据已重置为初始状态');
  };

  const handleLogout = () => {
    logout();
    success('已退出登录');
    navigate('/');
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
                    ? 'border-brand-500 ring-2 ring-brand-200'
                    : 'border-transparent opacity-75 hover:opacity-100'
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
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            variant="contained"
            size="large"
            startIcon={<SaveIcon />}
            onClick={handleSave}
          >
            保存修改
          </Button>
        </div>
      </div>

      {/* 演示工具 */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card md:p-6">
        <h2 className="text-base font-bold text-slate-800">演示工具</h2>
        <p className="mt-1 text-xs text-slate-400">
          所有数据保存在浏览器 localStorage 中，可一键重置回初始演示数据。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant="outlined"
            color="warning"
            startIcon={<RestartAltIcon />}
            onClick={handleReset}
          >
            重置演示数据
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<LogoutIcon />}
            onClick={handleLogout}
          >
            退出登录
          </Button>
        </div>
      </div>
    </div>
  );
}
