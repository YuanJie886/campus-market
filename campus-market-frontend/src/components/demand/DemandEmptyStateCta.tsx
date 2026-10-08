import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { DemandConditions, DemandSubscribeResult } from '../../api/contracts';
import { useAuth } from '../../context/AuthContext';
import DemandSubscribeDialog from './DemandSubscribeDialog';

/**
 * 搜索 / 筛选结果为空时的订阅入口（2.5）。
 *
 * <p>这是需求雷达的<b>主要</b>入口：用户刚刚表达了一个没被满足的需求，
 * 这时候问一句「要不要有货时告诉你」最自然，而不是让人自己去「我的」里找。
 */
export const DEMAND_DRAFT_KEY = 'campus_market_demand_draft_v1';

interface Props {
  /** 由当前搜索条件推导出的预填值。地理范围已是 canonical 值，不含任何展示文案 */
  prefill: DemandConditions;
  /**
   * 是否显示入口本身（搜索结果为空时）。组件始终挂载：登录回来后的草稿恢复
   * 不能依赖「结果仍为空」——那时筛选状态可能已经变了。
   */
  showCta: boolean;
}

function saveDraft(conditions: DemandConditions): void {
  // 只存订阅条件（关键词、分类、价格、范围），不含任何认证信息；会话结束即消失
  try { window.sessionStorage.setItem(DEMAND_DRAFT_KEY, JSON.stringify(conditions)) } catch { /* 隐私模式可忽略 */ }
}

function takeDraft(): DemandConditions | null {
  try {
    const raw = window.sessionStorage.getItem(DEMAND_DRAFT_KEY);
    window.sessionStorage.removeItem(DEMAND_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DemandConditions) : null;
  } catch {
    return null;
  }
}

export default function DemandEmptyStateCta({ prefill, showCta }: Props) {
  const { currentUser, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<DemandConditions>(prefill);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<DemandSubscribeResult | null>(null);
  const [undone, setUndone] = useState(false);

  // 登录回来后恢复草稿：只在带 resumeSubscribe 标记返回时恢复，避免无关页面突然弹窗
  useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(location.search);
    if (params.get('resumeSubscribe') !== '1') return;
    const draft = takeDraft();
    params.delete('resumeSubscribe');
    navigate({ search: params.toString() }, { replace: true });
    if (draft) {
      setInitial(draft);
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const start = () => {
    if (!isAuthenticated) {
      saveDraft(prefill);
      // 登录后回到同一个搜索页，并带上恢复标记
      const back = new URLSearchParams(location.search);
      back.set('resumeSubscribe', '1');
      navigate('/login', { state: { from: `${location.pathname}?${back.toString()}` } });
      return;
    }
    setInitial(prefill);
    setErrorMessage(null);
    setOpen(true);
  };

  const submit = async (conditions: DemandConditions) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const created = await getApiClient().createDemandSubscription(conditions);
      setResult(created);
      setUndone(false);
      setOpen(false);
    } catch (e) {
      setErrorMessage(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!result || result.outcome === 'EXISTING') return;
    try {
      await getApiClient().deleteDemandSubscription(result.subscription.id);
      setUndone(true);
    } catch (e) {
      setErrorMessage(toUserMessage(e));
    }
  };

  return (
    <>
      {showCta && (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-center">
          <p className="text-sm text-slate-700">没有找到？订阅一下，有货第一时间通知你。</p>
          <Button variant="contained" size="small" sx={{ mt: 1.5, borderRadius: 999 }} onClick={start}>
            订阅这个需求
          </Button>
        </div>
      )}

      <DemandSubscribeDialog
        open={open}
        title="订阅这个需求"
        submitLabel="确认订阅"
        initial={initial}
        userCampus={currentUser?.campus ?? '东校区'}
        busy={busy}
        errorMessage={errorMessage}
        onCancel={() => setOpen(false)}
        onSubmit={(c) => void submit(c)}
      />

      <Snackbar
        open={!!result}
        autoHideDuration={8000}
        onClose={(_e, reason) => { if (reason !== 'clickaway') setResult(null) }}
      >
        <Alert
          severity={result?.outcome === 'EXISTING' ? 'info' : 'success'}
          onClose={() => setResult(null)}
          action={
            <>
              {result && result.outcome !== 'EXISTING' && !undone && (
                <Button color="inherit" size="small" onClick={() => void undo()}>撤销</Button>
              )}
              <Button color="inherit" size="small" component={Link} to="/demands?tab=subscriptions">
                管理订阅
              </Button>
            </>
          }
        >
          {undone
            ? '已撤销这条订阅'
            : result?.outcome === 'EXISTING'
              ? '你已经订阅过相同条件，没有重复创建'
              : '订阅成功，有匹配的新商品时会出现在「需求匹配」里'}
        </Alert>
      </Snackbar>
    </>
  );
}
