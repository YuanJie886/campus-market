import { useState } from 'react';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';

/**
 * 仅离线演示（VITE_API_MODE=mock）：代替「学校管理员线下核对身份后签发重置码」这一步，方便体验找回密码。
 * 这个组件只在 Mock 构建里被懒加载；REST 构建里对应的 import 在构建期被常量折叠删掉（check-bundles 以
 * 「demo-reset-code」标记验证）。真实部署里重置码只能由本校学校管理员在管理后台签发（POST /v1/admin/users/{id}/password-reset）。
 */
export default function DemoResetCodeIssuer({ onIssued }: { onIssued?: (account: string, code: string) => void }) {
  const [account, setAccount] = useState('');
  const [status, setStatus] = useState('');
  const issue = async () => {
    const api = getApiClient() as unknown as { demoIssueResetCode?: (account: string) => Promise<{ code: string; expiresAt: number } | null> };
    if (!api.demoIssueResetCode) return;
    try {
      const result = await api.demoIssueResetCode(account);
      if (!result) { setStatus('演示数据里没有这个账号。'); return }
      setStatus(`演示重置码：${result.code}（30 分钟内有效，只在这个页面里有效，刷新即失效）`);
      onIssued?.(account.trim(), result.code);
    } catch (e) {
      setStatus(toUserMessage(e));
    }
  };
  return (
    <section aria-labelledby="demo-reset-title" data-marker="demo-reset-code" className="space-y-2 rounded-2xl border border-dashed border-slate-300 p-4">
      <h2 id="demo-reset-title" className="text-sm font-bold text-slate-800">离线演示：模拟学校工作人员签发重置码</h2>
      <p className="text-xs text-slate-700">只在离线演示模式里出现；真实部署没有这个入口，重置码由本校学校管理员核对身份后在管理后台签发。</p>
      <div className="flex flex-wrap items-center gap-2">
        <TextField size="small" label="演示账号" value={account} onChange={(e) => setAccount(e.target.value)} />
        <Button size="small" variant="outlined" onClick={() => void issue()} disabled={!account.trim()}>签发演示重置码</Button>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-emerald-800">{status}</p>
    </section>
  );
}
