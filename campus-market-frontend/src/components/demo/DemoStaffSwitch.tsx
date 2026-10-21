import { useState } from 'react';
import Button from '@mui/material/Button';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { StaffRole, StaffStatus } from '../../api/contracts';

/**
 * 仅离线演示（VITE_API_MODE=mock）：把当前用户设为本校平台工作人员，方便体验治理工作台。
 * 这个组件只在 Mock 构建里被懒加载；REST 构建里对应的 import 在构建期被常量折叠删掉（check-bundles 以
 * 「demo-staff-switch」标记验证）。演示种子里没有任何预置的工作人员。
 */
export default function DemoStaffSwitch() {
  const [status, setStatus] = useState('');
  const become = async (role: StaffRole) => {
    const api = getApiClient() as unknown as { demoBecomeStaff?: (role: StaffRole) => Promise<StaffStatus> };
    if (!api.demoBecomeStaff) return;
    try {
      await api.demoBecomeStaff(role);
      setStatus(role === 'SENIOR_MODERATOR' ? '已设为演示用的高级工作人员，刷新页面后导航栏会出现「治理工作台」。' : '已设为演示用的工作人员，刷新页面后导航栏会出现「治理工作台」。');
    } catch (e) {
      setStatus(toUserMessage(e));
    }
  };
  return (
    <section aria-labelledby="demo-staff-title" data-marker="demo-staff-switch" className="space-y-2 rounded-2xl border border-dashed border-slate-300 p-4">
      <h3 id="demo-staff-title" className="text-sm font-bold text-slate-800">离线演示：体验治理工作台</h3>
      <p className="text-xs text-slate-700">只在离线演示模式里出现；真实部署没有这个入口，首个工作人员由运维按手册用受控 SQL 配置。</p>
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="outlined" onClick={() => void become('MODERATOR')}>设为演示工作人员</Button>
        <Button size="small" variant="outlined" onClick={() => void become('SENIOR_MODERATOR')}>设为演示高级工作人员</Button>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-emerald-800">{status}</p>
    </section>
  );
}
