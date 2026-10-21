import TextField from '@mui/material/TextField';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../api/contracts';

/** 新密码 + 确认新密码：修改密码与凭重置码找回共用同一套校验与提示 */
export function newPasswordProblem(next: string, confirm: string): string | null {
  const length = next.trim().length;
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) return `新密码需要 ${PASSWORD_MIN}～${PASSWORD_MAX} 位`;
  if (next !== confirm) return '两次输入的新密码不一致';
  return null;
}

interface Props {
  idPrefix: string;
  next: string;
  confirm: string;
  onNext: (value: string) => void;
  onConfirm: (value: string) => void;
}

export default function NewPasswordFields({ idPrefix, next, confirm, onNext, onConfirm }: Props) {
  return (
    <>
      <TextField
        id={`${idPrefix}-new`}
        label="新密码"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => onNext(e.target.value)}
        helperText={`${PASSWORD_MIN}～${PASSWORD_MAX} 位`}
        inputProps={{ maxLength: PASSWORD_MAX + 8 }}
        fullWidth
        required
      />
      <TextField
        id={`${idPrefix}-confirm`}
        label="确认新密码"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => onConfirm(e.target.value)}
        inputProps={{ maxLength: PASSWORD_MAX + 8 }}
        fullWidth
        required
      />
    </>
  );
}
