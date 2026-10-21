import type { ReactNode } from 'react';
import SearchOffIcon from '@mui/icons-material/SearchOff';

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/** 通用空状态：图标 + 文案 + 可选操作（样式与小程序 .empty 一致，见 index.css 的 .cm-empty） */
export default function EmptyState({
  title = '这里空空如也',
  description = '',
  action,
  icon,
}: EmptyStateProps) {
  return (
    <div className="cm-empty">
      <div className="cm-empty-symbol" aria-hidden="true">
        {icon ?? <SearchOffIcon sx={{ fontSize: 28 }} />}
      </div>
      <h3 className="cm-empty-title">{title}</h3>
      {description && <p className="cm-empty-description">{description}</p>}
      {action && <div className="cm-empty-action">{action}</div>}
    </div>
  );
}
