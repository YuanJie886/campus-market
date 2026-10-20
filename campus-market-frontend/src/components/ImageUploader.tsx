import { useEffect, useId, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import { getApiClient } from '../api/client';
import { ApiError, toUserMessage } from '../api/errors';
import { useClientConfig } from '../hooks/useClientConfig';
import { displaySrcOf, imageBytesText, imageFileProblem, imageTooLargeText, imageTypesText, rememberUploadedImage } from '../utils/images';
import ImageWithFallback from './ImageWithFallback';

interface PendingUpload { key: string; name: string; status: 'uploading' | 'error'; message: string }

interface Props {
  /** 当前的图片：upload:<id> 引用、签名地址（编辑已有商品时）或外部示例图地址，顺序即展示顺序 */
  value: string[];
  onChange: (next: string[]) => void;
  /** 最多几张；缺省使用 GET /v1/config 的 images.maxCount（默认 9），三个编辑器都不再传 */
  max?: number;
  /** 区块标题，例如「商品图片」 */
  label: string;
  /** 文件输入框的 id：表单校验失败时把焦点移到这里 */
  inputId: string;
  /** 预置示例图（过渡期保留）；不传则不显示。服务端不允许外部图片（externalAllowed=false）时也不显示，
   *  但商品上已有的外部图片照常显示，可以保留或移除 */
  presets?: readonly string[];
  /** 预置图按钮的可访问名称（保持各表单原有的叫法） */
  presetLabel?: (index: number) => string;
  /** thumb：缩略图按钮；compact：「图 n / 已选」小按钮 */
  presetVariant?: 'thumb' | 'compact';
  error?: string | null;
  /** 正在上传的张数：表单在上传完成前不提交 */
  onPendingChange?: (count: number) => void;
  emoji?: string;
  gradient?: string;
}

/**
 * 商品图片：单件发布 / 编辑、整套打包、批量发布的每一件共用。
 *
 * <ul>
 *   <li>张数、单张大小、类型与是否允许外部示例图来自 GET /v1/config（旧后端为 9 张 / 5 MB / JPEG、PNG / 允许）；</li>
 *   <li>本地先检查类型与大小，服务端仍按文件头再判断；</li>
 *   <li>每张图片单独上传、单独显示进度与错误（413「图片不能超过 5 MB」，400 / 429 原样显示服务端的话）；</li>
 *   <li>上传成功后表单里保存服务端返回的 ref（upload:&lt;id&gt;），显示用返回的签名地址；</li>
 *   <li>可以移除、上移、下移；上传状态通过 aria-live 区域播报。</li>
 * </ul>
 */
export default function ImageUploader({
  value, onChange, max: maxOverride, label, inputId, presets, presetLabel = (i) => `选择图片 ${i + 1}`, presetVariant = 'thumb',
  error, onPendingChange, emoji, gradient,
}: Props) {
  const { config, loading: configLoading } = useClientConfig();
  const rules = config.images;
  const max = maxOverride ?? rules.maxCount;
  const showPresets = !configLoading && rules.externalAllowed && !!presets && presets.length > 0;
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const latest = useRef(value);
  latest.current = value;
  const helpId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = pending.filter((p) => p.status === 'uploading').length;

  useEffect(() => { onPendingChange?.(uploading) }, [uploading, onPendingChange]);

  const commit = (next: string[]) => { latest.current = next; onChange(next) };
  const updatePending = (key: string, patch: Partial<PendingUpload> | null) =>
    setPending((list) => (patch ? list.map((p) => (p.key === key ? { ...p, ...patch } : p)) : list.filter((p) => p.key !== key)));

  const upload = async (file: File, key: string) => {
    try {
      const result = await getApiClient().uploadImage(file);
      rememberUploadedImage(result.ref, result.url);
      updatePending(key, null);
      if (latest.current.length >= max) {
        setAnnouncement(`最多 ${max} 张图片，「${file.name}」没有加入`);
        return;
      }
      commit([...latest.current, result.ref]);
      setAnnouncement(`「${file.name}」上传成功`);
    } catch (e) {
      const message = e instanceof ApiError && (e.httpStatus === 413 || e.code === 413) ? imageTooLargeText(rules.maxBytes) : toUserMessage(e, '上传失败，请重试');
      updatePending(key, { status: 'error', message });
      setAnnouncement(`「${file.name}」上传失败：${message}`);
    }
  };

  const choose = (files: FileList | null) => {
    if (!files?.length) return;
    let room = max - latest.current.length - uploading;
    const added: PendingUpload[] = [];
    const starts: Array<[File, string]> = [];
    for (const file of Array.from(files)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const problem = room <= 0 ? `最多 ${max} 张图片` : imageFileProblem(file, rules);
      if (problem) {
        added.push({ key, name: file.name, status: 'error', message: problem });
        continue;
      }
      room -= 1;
      added.push({ key, name: file.name, status: 'uploading', message: '' });
      starts.push([file, key]);
    }
    setPending((list) => [...list, ...added]);
    const failed = added.filter((a) => a.status === 'error');
    setAnnouncement(
      [starts.length ? `正在上传 ${starts.length} 张图片` : '', ...failed.map((f) => `「${f.name}」不能上传：${f.message}`)].filter(Boolean).join('；'),
    );
    for (const [file, key] of starts) void upload(file, key);
    // 允许再次选择同一个文件（例如失败后重试）
    if (fileInput.current) fileInput.current.value = '';
  };

  const move = (index: number, delta: -1 | 1) => {
    const next = [...value];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
    setAnnouncement(`第 ${index + 1} 张已移到第 ${target + 1} 张`);
  };
  const remove = (index: number) => {
    commit(value.filter((_, i) => i !== index));
    setAnnouncement(`已移除第 ${index + 1} 张图片`);
  };
  const togglePreset = (url: string) => {
    if (value.includes(url)) { commit(value.filter((x) => x !== url)); return }
    if (value.length + uploading >= max) { setAnnouncement(`最多 ${max} 张图片`); return }
    commit([...value, url]);
  };

  return (
    <fieldset className="space-y-2" aria-describedby={helpId}>
      <legend className="text-sm font-semibold text-slate-700">{label}（{value.length}/{max}）</legend>
      <p id={helpId} className="text-xs text-slate-600">
        支持 {imageTypesText(rules.accept)}，单张不超过 {imageBytesText(rules.maxBytes)}，最多 {max} 张。上传后服务端会去掉拍摄地点、设备等元数据；第一张作为封面。
      </p>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="text-sm text-slate-700">上传图片</label>
        <input
          ref={fileInput}
          id={inputId}
          type="file"
          accept={rules.accept.join(',')}
          multiple
          disabled={value.length + uploading >= max}
          onChange={(e) => choose(e.target.files)}
          className="max-w-full text-sm"
        />
      </div>

      {value.length > 0 && (
        <ol aria-label={`已选的${label}`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {value.map((item, index) => (
            <li key={`${item}-${index}`} className="space-y-1 rounded-xl border border-slate-200 p-1">
              <ImageWithFallback
                src={displaySrcOf(item)}
                alt={`${label}第 ${index + 1} 张${index === 0 ? '（封面）' : ''}`}
                emoji={emoji}
                gradient={gradient}
                className="aspect-square w-full rounded-lg"
              />
              <div className="flex flex-wrap gap-1">
                <Button size="small" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`上移第 ${index + 1} 张图片`}>上移</Button>
                <Button size="small" onClick={() => move(index, 1)} disabled={index === value.length - 1} aria-label={`下移第 ${index + 1} 张图片`}>下移</Button>
                <Button size="small" color="error" onClick={() => remove(index)} aria-label={`移除第 ${index + 1} 张图片`}>移除</Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {pending.length > 0 && (
        <ul aria-label="上传进度" className="space-y-1">
          {pending.map((p) => (
            <li key={p.key} className={`flex flex-wrap items-center gap-2 text-xs ${p.status === 'error' ? 'text-red-700' : 'text-slate-700'}`}>
              {p.status === 'uploading' ? (
                <>
                  <progress aria-label={`「${p.name}」上传进度`} className="h-2 w-24" />
                  <span>「{p.name}」上传中…</span>
                </>
              ) : (
                <>
                  <span>「{p.name}」上传失败：{p.message}</span>
                  <Button size="small" onClick={() => updatePending(p.key, null)} aria-label={`关闭「${p.name}」的错误提示`}>知道了</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {showPresets && presets && (
        <div className="space-y-1">
          <p className="text-xs text-slate-600">或选择示例图（外部图片，过渡期保留）：</p>
          <div className={presetVariant === 'thumb' ? 'grid grid-cols-4 gap-2 sm:grid-cols-6' : 'grid grid-cols-6 gap-2'}>
            {presets.map((url, i) => {
              const selected = value.includes(url);
              return presetVariant === 'thumb' ? (
                <button
                  key={url}
                  type="button"
                  onClick={() => togglePreset(url)}
                  className={`relative overflow-hidden rounded-xl border-2 transition ${selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-transparent'}`}
                  aria-label={presetLabel(i)}
                  aria-pressed={selected}
                >
                  <ImageWithFallback src={url} alt={`预置图片 ${i + 1}`} emoji={emoji} gradient={gradient} className="aspect-square w-full" />
                  {/* 纯视觉标记：选中状态已由按钮的 aria-pressed 表达 */}
                  <span
                    aria-hidden="true"
                    className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 text-xs font-bold ${
                      selected ? 'border-white bg-brand-600 text-white' : 'border-white bg-black/20 text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                </button>
              ) : (
                <button
                  key={url}
                  type="button"
                  aria-pressed={selected}
                  aria-label={presetLabel(i)}
                  onClick={() => togglePreset(url)}
                  className={`h-10 rounded-lg border-2 text-xs ${selected ? 'border-teal-700 bg-teal-50' : 'border-slate-200'}`}
                >
                  {selected ? '已选' : `图 ${i + 1}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    </fieldset>
  );
}
