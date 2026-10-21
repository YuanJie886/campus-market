import { forwardRef, useId, useState } from 'react';
import Button from '@mui/material/Button';

interface Props {
  /** 例如「新邀请码（只显示这一次）」 */
  title: string;
  token: string;
  /** 有效期、对方在哪里输入 */
  note: string;
  /** 「我已保存，隐藏邀请码」；不传则不显示这个按钮（例如弹窗里由「完成」关闭） */
  onHide?: () => void;
}

export const COPY_DONE = '邀请码已复制';
export const COPY_FAILED = '无法自动复制，请手动选中复制';

/**
 * 只显示这一次的邀请码（与小程序 InviteCodeBox 一致，以邀请码为主，不生成链接）：
 * 邀请码只在调用方的内存状态里，不写浏览器存储、不放进地址栏；隐藏或离开页面后无法再次查看。
 * 「复制邀请码」只在用户点击时写入剪贴板，从不读取剪贴板。
 */
const InviteCodeBox = forwardRef<HTMLDivElement, Props>(function InviteCodeBox({ title, token, note, onHide }, ref) {
  const titleId = useId();
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(token);
      setCopied(COPY_DONE);
    } catch {
      setCopied(COPY_FAILED);
    }
  };
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-labelledby={titleId}
      className="space-y-2 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3 outline-none">
      <p id={titleId} className="text-sm font-bold text-indigo-900">{title}</p>
      <p className="select-all break-all rounded-lg bg-white px-3 py-2 font-mono text-lg font-bold tracking-wide text-slate-900"
        data-testid="invite-code">{token}</p>
      <p className="text-xs text-slate-700">{note}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="small" variant="contained" onClick={() => void copy()}>复制邀请码</Button>
        {onHide && <Button size="small" variant="outlined" onClick={onHide}>我已保存，隐藏邀请码</Button>}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-emerald-800">{copied}</p>
    </div>
  );
});

export default InviteCodeBox;
