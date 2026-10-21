import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { CircleType, CircleVisibility } from '../../api/contracts';
import ErrorSummary, { type ErrorSummaryItem } from '../../components/trust/ErrorSummary';
import { CIRCLE_TYPE_LABEL, CIRCLE_VISIBILITY_LABEL, USER_CREATED_NOTE } from '../../utils/circle';

const TYPES: CircleType[] = ['CLASS', 'CLUB', 'INTEREST', 'OTHER'];
const VISIBILITIES: CircleVisibility[] = ['PRIVATE', 'DISCOVERABLE'];

/** 创建圈子。类型不预选；可见性默认私密。平台不核验班级或社团身份。 */
export default function CircleCreatePage() {
  const navigate = useNavigate();
  const [type, setType] = useState<CircleType | ''>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<CircleVisibility>('PRIVATE');
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focus = (id: string) => () => document.getElementById(id)?.focus();

  const submit = async () => {
    const problems: ErrorSummaryItem[] = [];
    const trimmed = name.trim();
    if (!type) problems.push({ key: 'type', message: '请选择圈子类型', focus: focus('circle-type') });
    if (trimmed.length < 2 || trimmed.length > 30) problems.push({ key: 'name', message: '圈子名称需要 2～30 个字', focus: focus('circle-name') });
    else if (/[<>]/.test(trimmed)) problems.push({ key: 'name', message: '圈子名称不能包含尖括号', focus: focus('circle-name') });
    if (description.trim().length > 200) problems.push({ key: 'description', message: '简介最多 200 个字', focus: focus('circle-description') });
    setSummary(problems);
    if (problems.length) { window.setTimeout(() => summaryRef.current?.focus(), 0); return }
    setBusy(true);
    setError(null);
    try {
      const circle = await getApiClient().createCircle({ type: type as CircleType, name: trimmed, description: description.trim(), visibility });
      navigate(`/circles/${encodeURIComponent(circle.id)}`);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">创建圈子</h1>
      <Alert severity="info" role="note">用户创建的圈子，未经学校核实。{USER_CREATED_NOTE}平台不核验班级、社团等身份。</Alert>
      <ErrorSummary ref={summaryRef} title="创建前请先修正以下问题" items={summary} />
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit() }} aria-label="创建圈子">
        <TextField id="circle-type" select label="圈子类型" value={type} onChange={(e) => setType(e.target.value as CircleType)} size="small" fullWidth
          helperText="只是给成员看的分类，不代表任何身份认证">
          {TYPES.map((t) => <MenuItem key={t} value={t}>{CIRCLE_TYPE_LABEL[t]}</MenuItem>)}
        </TextField>
        <TextField id="circle-name" label="圈子名称" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth
          inputProps={{ maxLength: 30 }} helperText="2～30 个字" />
        <TextField id="circle-description" label="简介（选填）" value={description} onChange={(e) => setDescription(e.target.value)} size="small" fullWidth
          multiline minRows={2} inputProps={{ maxLength: 200 }} />
        <TextField id="circle-visibility" select label="谁能发现这个圈子" value={visibility} onChange={(e) => setVisibility(e.target.value as CircleVisibility)}
          size="small" fullWidth helperText="无论哪种，加入都需要成员的邀请码">
          {VISIBILITIES.map((v) => <MenuItem key={v} value={v}>{CIRCLE_VISIBILITY_LABEL[v]}</MenuItem>)}
        </TextField>
        {error && <Alert severity="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button color="inherit" onClick={() => navigate('/circles')}>取消</Button>
          <Button type="submit" variant="contained" disabled={busy}>创建</Button>
        </div>
      </form>
    </div>
  );
}
