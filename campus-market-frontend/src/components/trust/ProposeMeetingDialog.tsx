import { useEffect, useId, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import type { MeetingPoint, MeetingProposalInput } from '../../api/contracts';
import { DURATION_OPTIONS, START_SLOTS, slotToIso, upcomingDays } from '../../utils/trustedFlow';

export const PROPOSAL_NOTE_MAX = 100;

interface Props {
  open: boolean;
  /** 订单所在校区、且仍启用的面交点 */
  points: MeetingPoint[];
  busy?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (input: MeetingProposalInput) => void;
  /** 仅测试注入「现在」 */
  now?: () => Date;
}

/**
 * 面交档期提议。时间只能从离散选项中选：未来 7 天 × 固定开始时间 × 固定时长，
 * 不接受自由文本时间；备注只作有限长度的补充。
 */
export default function ProposeMeetingDialog({ open, points, busy, errorMessage, onCancel, onSubmit, now = () => new Date() }: Props) {
  const days = useMemo(() => upcomingDays(now()), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pointId, setPointId] = useState('');
  const [day, setDay] = useState('');
  const [start, setStart] = useState('');
  const [duration, setDuration] = useState<number>(60);
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const errorId = useId();

  useEffect(() => {
    if (!open) return;
    setPointId('');
    setDay(days[0]?.key ?? '');
    setStart('');
    setDuration(60);
    setNote('');
    setLocalError(null);
  }, [open, days]);

  // 当天只提供尚未开始的时段
  const startOptions = useMemo(() => {
    if (!day) return START_SLOTS;
    const current = now().getTime();
    return START_SLOTS.filter((s) => Date.parse(slotToIso(day, s, 30).startsAtIso) > current);
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (start && !startOptions.includes(start)) setStart('');
  }, [startOptions, start]);

  const submit = () => {
    if (!pointId) return setLocalError('请选择面交点');
    if (!day || !start) return setLocalError('请选择日期和开始时间');
    const { startsAtIso, endsAtIso } = slotToIso(day, start, duration);
    if (Date.parse(startsAtIso) <= now().getTime()) return setLocalError('不能选择已经过去的时间');
    if (note.trim().length > PROPOSAL_NOTE_MAX) return setLocalError(`备注最多 ${PROPOSAL_NOTE_MAX} 个字`);
    setLocalError(null);
    onSubmit({ meetingPointId: pointId, startsAtIso, endsAtIso, ...(note.trim() ? { note: note.trim() } : {}) });
  };

  const shownError = localError ?? errorMessage ?? null;
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} fullWidth maxWidth="xs" aria-labelledby="propose-meeting-title">
      <DialogTitle id="propose-meeting-title">提议面交档期</DialogTitle>
      <DialogContent>
        <p className="mb-3 text-xs text-slate-600">
          对方接受后新档期才生效；在那之前，已确认的档期保持不变。
        </p>
        <div className="flex flex-col gap-3">
          <TextField select label="面交点" value={pointId} onChange={(e) => setPointId(e.target.value)} fullWidth>
            {points.length === 0 && <MenuItem value="" disabled>该校区暂无可用面交点</MenuItem>}
            {points.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          <TextField select label="日期" value={day} onChange={(e) => setDay(e.target.value)} fullWidth>
            {days.map((d) => <MenuItem key={d.key} value={d.key}>{d.label}</MenuItem>)}
          </TextField>
          <div className="grid grid-cols-2 gap-3">
            <TextField select label="开始时间" value={start} onChange={(e) => setStart(e.target.value)} fullWidth>
              {startOptions.length === 0 && <MenuItem value="" disabled>今天已无可选时段</MenuItem>}
              {startOptions.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField select label="时长" value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))} fullWidth>
              {DURATION_OPTIONS.map((m) => <MenuItem key={m} value={String(m)}>{m < 60 ? `${m} 分钟` : `${m / 60} 小时`}</MenuItem>)}
            </TextField>
          </div>
          <TextField
            label="备注（选填）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            inputProps={{ maxLength: PROPOSAL_NOTE_MAX }}
            helperText={`${note.length}/${PROPOSAL_NOTE_MAX}，请不要填写房间号、床位号或联系方式`}
            fullWidth
          />
          {shownError && <p id={errorId} className="text-sm text-red-700" role="alert">{shownError}</p>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy} color="inherit">取消</Button>
        <Button onClick={submit} disabled={busy} variant="contained" aria-describedby={shownError ? errorId : undefined}>
          发送提议
        </Button>
      </DialogActions>
    </Dialog>
  );
}
