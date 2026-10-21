import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Button, Picker, Text, View } from '@tarojs/components';
import { useRef, useState } from 'react';
import { api } from '../../../api';
import { ApiError } from '../../../api/transport';
import { Empty, LoginGate, PageTitle } from '../../../components';
import { BATCH_MAX_ITEMS, type AssistInvite, type ListingBatch, type ListingBatchSummary, type ListingDraft, type ListingKind, type PublishBatchResult } from '../../../model';
import {
  ASSISTED_PUBLISH_TEXT, ASSIST_EXPIRY_OPTIONS, ASSIST_INVITE_STATUS, ASSIST_REVOKED_DONE, ASSIST_SCOPE_TEXT, ASSIST_TOKEN_ONCE, BATCH_CONFLICT, BATCH_INTRO, BATCH_REJECTED,
  PUBLISH_ALL_OR_NOTHING, PUBLISH_CONTACT_NOTE, VALIDATION_LABEL, batchCheckProblems, batchPublishProblems, copyCommonFields, draftTitle, newIdempotencyKey, publishFailedText, type BatchProblem,
} from '../../../supply';
import { formatDateTime } from '../../../governance';
import { SUPPLY_PAGES } from '../../../menu';
import { useMarket } from '../../../state';
import { InviteCodeBox } from '../../../widgets/InviteCodeBox';
import { DraftEditor } from '../DraftEditor';

/**
 * 毕业季快速发布（任何时候都可以用）：一个批次最多 20 件，逐件保存为草稿，全部通过校验后一次确认发布——
 * 要么全部发布，要么一件都不发布。同一次发布尝试（含网络失败后的重试）沿用同一个幂等键。
 */
export default function BatchesPage() {
  const { user } = useMarket(), batchId = useRouter().params.batch ?? '';
  const [batches, setBatches] = useState<ListingBatchSummary[] | null>(null), [batch, setBatch] = useState<ListingBatch | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [copyCommon, setCopyCommon] = useState(false), [reloadTick, setReloadTick] = useState(0);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [problems, setProblems] = useState<BatchProblem[]>([]), [publishing, setPublishing] = useState(false), [result, setResult] = useState<PublishBatchResult | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false), [hours, setHours] = useState(24), [token, setToken] = useState(''), [invites, setInvites] = useState<AssistInvite[]>([]);
  const publishKey = useRef<string | null>(null);

  const loadInvites = async (id: string) => { try { setInvites((await api.assistInvites()).filter((i) => i.batchId === id)); } catch { /* 邀请列表失败不影响批次 */ } };
  const loadBatch = async (id: string) => {
    try { const b = await api.batch(id); setBatch(b); setError(''); return b; }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败'); return null; }
  };
  const load = async () => {
    if (!user) return;
    if (batchId) { await loadBatch(batchId); await loadInvites(batchId); return; }
    try { setBatches(await api.batches()); } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
  };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });

  const items = batch?.items ?? [];
  const current = items.find((i) => i.draft.id === selected) ?? items[0] ?? null;
  const open = batch?.status === 'OPEN';

  const newBatch = async () => {
    try { const b = await api.createBatch({ draftIds: [] }); void Taro.navigateTo({ url: `${SUPPLY_PAGES.batches}?batch=${encodeURIComponent(b.id)}` }); }
    catch (e) { setError(e instanceof Error ? e.message : '创建失败'); }
  };
  const replaceItems = async (draftIds: string[]) => {
    if (!batch) return null;
    try { const b = await api.updateBatch(batch.id, { expectedVersion: batch.version, draftIds }); setBatch(b); publishKey.current = null; return b; }
    catch (e) { setError(e instanceof ApiError && e.code === 409 ? BATCH_CONFLICT : e instanceof Error ? e.message : '操作失败'); return null; }
  };
  const addItem = async (draftType: ListingKind) => {
    if (!batch || items.length >= BATCH_MAX_ITEMS) return;
    setError('');
    try {
      const previous = items[items.length - 1]?.draft.payload;
      const draft = await api.createDraft({ draftType, payload: copyCommon && previous ? copyCommonFields(previous) : {} });
      const b = await replaceItems([...items.map((i) => i.draft.id), draft.id]);
      if (b) { setSelected(draft.id); setStatus(`已添加第 ${b.items.length} 件`); }
    } catch (e) { setError(e instanceof Error ? e.message : '添加失败'); }
  };
  const removeItem = async (draftId: string) => {
    const b = await replaceItems(items.map((i) => i.draft.id).filter((id) => id !== draftId));
    if (b) { setSelected(b.items[0]?.draft.id ?? null); setStatus('已从批次移出，草稿仍保留在「我的草稿」里'); }
  };
  const onSaved = (saved: ListingDraft) => {
    if (!batch) return;
    publishKey.current = null;
    setBatch({ ...batch, items: batch.items.map((i) => (i.draft.id === saved.id ? { ...i, draft: saved } : i)) });
    void loadBatch(batch.id);
  };
  const check = async () => {
    if (!batch) return null;
    const b = await loadBatch(batch.id);
    if (!b) return null;
    const list = batchCheckProblems(b.items);
    setProblems(list);
    if (!list.length) setStatus(b.items.length ? `${b.items.length} 件全部可以发布` : '批次里还没有商品');
    return { b, list };
  };
  const publish = async () => {
    const checked = await check();
    if (!checked || !checked.b.items.length || checked.list.length || !batch) return;
    const answer = await Taro.showModal({ title: `确认一次发布 ${checked.b.items.length} 件？`, content: [PUBLISH_ALL_OR_NOTHING, ...(checked.b.assisted ? [ASSISTED_PUBLISH_TEXT] : []), PUBLISH_CONTACT_NOTE].join('\n'), confirmText: '确认发布', cancelText: '再检查一下', confirmColor: '#194e41' });
    if (!answer.confirm) return;
    publishKey.current ??= newIdempotencyKey();
    setPublishing(true);
    try { const r = await api.publishBatch(batch.id, publishKey.current); setResult(r); publishKey.current = null; await loadBatch(batch.id); }
    catch (e) {
      // 先刷新批次（刷新会清掉上一次的错误提示），再写这一次失败的说明
      await loadBatch(batch.id); setStatus('');
      const list = batchPublishProblems(e);
      if (list) { setProblems(list); setError(BATCH_REJECTED); }
      else setError(publishFailedText(e instanceof Error ? e.message : '请稍后重试'));
    } finally { setPublishing(false); }
  };
  const createInvite = async () => {
    if (!batch) return;
    try { const r = await api.createAssistInvite({ batchId: batch.id, expiresInHours: hours }); setToken(r.token); await loadInvites(batch.id); }
    catch (e) { setError(e instanceof Error ? e.message : '生成失败'); }
  };
  const revokeInvite = async (invite: AssistInvite) => {
    try { await api.revokeAssistInvite(invite.id); setStatus(ASSIST_REVOKED_DONE); if (batch) await loadInvites(batch.id); }
    catch (e) { setError(e instanceof Error ? e.message : '撤销失败'); }
  };

  return <View className='page'>
    <PageTitle title='毕业季快速发布' subtitle={batchId ? undefined : BATCH_INTRO} />
    <LoginGate returnTo={batchId ? `${SUPPLY_PAGES.batches}?batch=${encodeURIComponent(batchId)}` : SUPPLY_PAGES.batches}>
      {error ? <View className='notice'><Text className='error-text'>{error}</Text>{batch ? <Text className='text-action' onClick={() => { setError(''); void loadBatch(batch.id).then(() => setReloadTick((n) => n + 1)); }}>重新加载批次</Text> : null}</View> : null}
      {status ? <Text className='notice sheet-line'>{status}</Text> : null}
      {!batchId ? <>
        <Button className='primary' onClick={() => void newBatch()}>新建批次</Button>
        <Text className='gov-heading'>未发布的批次</Text>
        {batches === null ? <Empty title='正在读取…' /> : !batches.filter((b) => b.status === 'OPEN').length ? <Text className='muted'>还没有未发布的批次。</Text>
          : batches.filter((b) => b.status === 'OPEN').map((b) => <View key={b.id} className='req-card' onClick={() => void Taro.navigateTo({ url: `${SUPPLY_PAGES.batches}?batch=${encodeURIComponent(b.id)}` })}>
            <Text className='req-name'>{formatDateTime(b.createdAt)} 创建的批次（{b.itemCount} 件）</Text>
          </View>)}
      </> : !batch ? <Empty title='正在读取批次…' /> : <>
        {result && <View className='panel'>
          <Text className='section-title'>已发布 {result.publishedCount} 件</Text>
          {result.productIds.map((id, i) => <Text key={id} className='text-action sheet-line' onClick={() => void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(id)}` })}>查看第 {i + 1} 件</Text>)}
        </View>}
        {problems.length > 0 && <View className='problem-box'>
          <Text className='section-title'>还有 {problems.length} 件需要修改</Text>
          {problems.map((p) => <Text key={p.draftId} className='error-text text-action' onClick={() => setSelected(p.draftId)}>· {p.text}</Text>)}
        </View>}
        <Text className='muted'>共 {items.length} / {BATCH_MAX_ITEMS} 件{open ? '' : ' · 已发布'}</Text>
        {items.map((i) => <View key={i.draft.id} className={`req-card ${current?.draft.id === i.draft.id ? 'unread' : ''}`} onClick={() => setSelected(i.draft.id)}>
          <View className='section-head'>
            <Text className='req-name'>第 {i.position} 件 · {draftTitle(i.draft)}</Text>
            {open && <Text className='text-action danger-text' onClick={(e) => { e.stopPropagation(); void removeItem(i.draft.id); }}>移出</Text>}
          </View>
          {i.validation ? <Text className='req-sub'>{VALIDATION_LABEL[i.validation.code]}</Text> : null}
        </View>)}
        {open && <View className='panel'>
          <View className='check-row' onClick={() => setCopyCommon(!copyCommon)}>
            <View className={`agreement-box ${copyCommon ? 'checked' : ''}`}>{copyCommon ? '✓' : ''}</View>
            <Text className='field-help'>新增时复制上一件的通用字段（校区、取货楼栋、联系方式）</Text>
          </View>
          <View className='button-row'>
            <Button className='secondary small' disabled={items.length >= BATCH_MAX_ITEMS} onClick={() => void addItem('SINGLE')}>添加单件</Button>
            <Button className='secondary small' disabled={items.length >= BATCH_MAX_ITEMS} onClick={() => void addItem('BUNDLE')}>添加整套打包</Button>
          </View>
          <Text className='text-action' onClick={() => { setInviteOpen(!inviteOpen); setToken(''); }}>{inviteOpen ? '收起邀请' : '邀请协助整理'}</Text>
        </View>}
        {inviteOpen && open && <View className='panel'>
          <Text className='section-title'>邀请协助整理发布</Text>
          <Text className='field-help'>{ASSIST_SCOPE_TEXT}</Text>
          {!token ? <View className='inline-row'>
            <Picker range={ASSIST_EXPIRY_OPTIONS.map((o) => o.label)} value={ASSIST_EXPIRY_OPTIONS.findIndex((o) => o.hours === hours)} onChange={(e) => setHours(ASSIST_EXPIRY_OPTIONS[Number(e.detail.value)].hours)}>
              <View className='picker'><Text className='picker-value'>邀请有效期：{ASSIST_EXPIRY_OPTIONS.find((o) => o.hours === hours)?.label}</Text><View className='i-chevron' /></View>
            </Picker>
            <Button className='primary small' onClick={() => void createInvite()}>生成一次性邀请</Button>
          </View> : <InviteCodeBox title='邀请码（只显示这一次）' token={token} note={`${ASSIST_TOKEN_ONCE}对方在「我的 → 协助整理发布」里输入。`} onHide={() => { setToken(''); setInviteOpen(false); }} />}
        </View>}
        {invites.length > 0 && <View className='panel'>
          <Text className='section-title'>协助邀请</Text>
          {invites.map((i) => <View key={i.id} className='menu-row'>
            <Text className='menu-text'>{ASSIST_INVITE_STATUS[i.status]}{i.assistantNickname ? ` · 协助人：${i.assistantNickname}` : ''} · 有效期至 {formatDateTime(i.expiresAt)}</Text>
            {(i.status === 'PENDING' || i.status === 'ACTIVE') && <Text className='text-action' onClick={() => void revokeInvite(i)}>撤销邀请</Text>}
          </View>)}
        </View>}
        {current && open ? <DraftEditor key={`${current.draft.id}:${reloadTick}`} draft={current.draft} validation={current.validation} label={`第 ${current.position} 件`} onSaved={onSaved}
          onReload={() => void loadBatch(batch.id).then(() => setReloadTick((n) => n + 1))} />
          : !open ? <Text className='muted'>这个批次已{batch.status === 'PUBLISHED' ? '发布' : '丢弃'}，内容不能再修改。</Text>
            : <Text className='muted'>先添加一件商品。分类、价格、成色与验货声明都需要逐件填写，不会替你预先选择。</Text>}
        {open && <View className='step-actions'>
          <Button className='secondary back' onClick={() => void check()}>检查全部</Button>
          <Button className='primary next' disabled={!items.length || publishing} loading={publishing} onClick={() => void publish()}>发布这 {items.length} 件</Button>
        </View>}
      </>}
    </LoginGate>
  </View>;
}
