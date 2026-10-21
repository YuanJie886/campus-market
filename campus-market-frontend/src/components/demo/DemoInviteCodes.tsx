import { useState } from 'react';
import Button from '@mui/material/Button';
import { getApiClient } from '../../api/client';

interface DemoInviteApi {
  demoInviteCodes?: () => { inviteRequired: boolean; codes: { code: string; maxUses: number; remaining: number }[] };
  demoSetInviteRequired?: (required: boolean) => void;
}

/**
 * 仅离线演示（VITE_API_MODE=mock）：注册页下方的「演示邀请码」面板。
 * 真实部署的邀请码由学校工作人员发放；离线演示没有工作人员，这里直接列出内存里的演示邀请码（含剩余次数），点一下即可填入。
 * 同时提供「以邀请制运行离线演示」的开关（保存在本机，刷新页面后生效；默认关闭，与后端默认相同）。
 * 这个组件只在 Mock 构建里被懒加载；REST 构建里对应的 import 在构建期被常量折叠删掉（check-bundles 以「demo-invite-code」标记验证）。
 */
export default function DemoInviteCodes({ onPick }: { onPick?: (code: string) => void }) {
  const api = getApiClient() as unknown as DemoInviteApi;
  const [status, setStatus] = useState('');
  if (!api.demoInviteCodes) return null;
  const { inviteRequired, codes } = api.demoInviteCodes();
  const toggle = () => {
    api.demoSetInviteRequired?.(!inviteRequired);
    setStatus(inviteRequired ? '已关闭邀请制演示，刷新页面后生效。' : '已开启邀请制演示，刷新页面后注册需要填写邀请码。');
  };
  return (
    <section aria-labelledby="demo-invite-title" data-marker="demo-invite-code" className="space-y-2 rounded-2xl border border-dashed border-slate-300 p-4">
      <h2 id="demo-invite-title" className="text-sm font-bold text-slate-800">演示邀请码</h2>
      <p className="text-xs text-slate-700">只在离线演示模式里出现；真实部署没有这个入口，邀请码由学校工作人员发放。</p>
      {inviteRequired ? (
        <ul className="space-y-1">
          {codes.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
              <code className="font-mono text-sm text-slate-800">{c.code}</code>
              <span>剩余 {c.remaining} / {c.maxUses} 次</span>
              <Button size="small" variant="outlined" disabled={c.remaining === 0} aria-label={`填入演示邀请码 ${c.code}`}
                onClick={() => onPick?.(c.code)}>
                填入
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-700">离线演示目前不需要邀请码。</p>
      )}
      <Button size="small" variant="text" onClick={toggle}>{inviteRequired ? '关闭邀请制演示' : '以邀请制运行离线演示'}</Button>
      <p role="status" aria-live="polite" className="text-xs text-emerald-800">{status}</p>
    </section>
  );
}
