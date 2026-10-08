import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { getApiClient } from '../api/client';
import { toUserMessage } from '../api/errors';
import type { DemandConditions, DemandMatch, DemandSubscription } from '../api/contracts';
import { useAuth } from '../context/AuthContext';
import { useDemandUnreadCount } from '../context/DemandUnreadContext';
import { useNotify } from '../context/NotificationContext';
import DemandSubscribeDialog from '../components/demand/DemandSubscribeDialog';
import { describeConditions, reasonLabel, tierLabel } from '../utils/demand';
import { formatPrice, formatRelativeTime } from '../utils/format';

/**
 * 需求匹配收件箱与订阅管理（2.4 / 2.5）。
 *
 * <p>这里只展示<b>本人订阅</b>产生的匹配。「去预约面交」只是打开现有的预约流程：
 * 在售检查、不能买自己的商品、活跃订单唯一、面交点确认，一项都不绕过。
 */
type TabKey = 'matches' | 'subscriptions';

const INVALID_LABEL = { NO_LONGER_MATCHES: '已不再符合你的条件', NOT_ON_SALE: '已被预约或售出，暂不可购买' } as const;

export default function DemandsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'subscriptions' ? 'subscriptions' : 'matches';

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-extrabold text-slate-800 md:text-2xl">需求匹配</h1>
      <p className="mb-4 text-sm text-slate-500">
        你订阅的条件有新商品命中时会出现在这里。只在站内提醒，不发短信、微信或系统通知。
      </p>
      <Tabs
        value={tab}
        onChange={(_e, value: TabKey) => setParams(value === 'matches' ? {} : { tab: value })}
        aria-label="需求匹配分区"
      >
        <Tab value="matches" label="匹配收件箱" id="tab-matches" aria-controls="panel-matches" />
        <Tab value="subscriptions" label="我的订阅" id="tab-subscriptions" aria-controls="panel-subscriptions" />
      </Tabs>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-4">
        {tab === 'matches' ? <MatchInbox /> : <SubscriptionManager />}
      </div>
    </div>
  );
}

function MatchInbox() {
  const { refresh: refreshUnread } = useDemandUnreadCount();
  const { error } = useNotify();
  const [items, setItems] = useState<DemandMatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const page = await getApiClient().listDemandMatches(1, 50);
      if (current === sequence.current) {
        setItems(page.items);
        setLoadError(null);
      }
    } catch (e) {
      if (current === sequence.current) setLoadError(toUserMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
    // 页面重新可见时主动刷新，与导航角标的刷新时机一致
    const onVisible = () => { if (document.visibilityState === 'visible') void load() };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      sequence.current += 1;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const act = async (fn: () => Promise<number>) => {
    try {
      await fn();
      refreshUnread();
      await load();
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  if (loadError) {
    return (
      <Alert severity="warning" action={<Button onClick={() => void load()}>重试</Button>}>{loadError}</Alert>
    );
  }
  if (items === null) return <p className="text-sm text-slate-500" role="status">加载中…</p>;
  if (items.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center text-slate-500">
        <p>还没有匹配。在首页搜索没有结果时，可以直接订阅那个需求。</p>
        <Button component={Link} to="/" sx={{ mt: 2 }}>去逛逛</Button>
      </div>
    );
  }

  return (
    <ul className="space-y-3" aria-label="需求匹配列表">
      {items.map((m) => {
        return (
          <li key={m.id}>
            <article
              className={`space-y-2 rounded-2xl border bg-white p-4 shadow-card ${m.read ? 'border-slate-100' : 'border-emerald-300'}`}
              aria-label={`${m.product.title}${m.read ? '' : '，未读'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/product/${m.product.id}`} onClick={() => { if (!m.read) void act(() => getApiClient().markDemandMatchRead(m.id)) }}
                  className="font-bold text-slate-800">
                  {m.product.title}
                </Link>
                <span className="flex gap-1">
                  {!m.read && <Chip size="small" color="success" label="未读" />}
                  <Chip size="small" label={tierLabel(m.tier)} variant="outlined" data-tier={m.tier} />
                </span>
              </div>
              <p className="text-lg font-bold text-brand-600">{formatPrice(m.product.price)}</p>
              <p className="text-xs text-slate-500">
                命中订阅：{describeConditions(m.subscription)} · {formatRelativeTime(m.createdAt)}
              </p>
              <p className="text-xs text-slate-600">
                匹配理由：{m.reasonCodes.map((code) => reasonLabel(code)).join('、')}
              </p>
              {!m.valid && m.invalidReason && (
                <p className="text-xs text-amber-700">{INVALID_LABEL[m.invalidReason]}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="small" component={Link} to={`/product/${m.product.id}`}
                  onClick={() => { if (!m.read) void act(() => getApiClient().markDemandMatchRead(m.id)) }}>
                  查看商品
                </Button>
                {m.valid && (
                  <Button size="small" variant="contained" component={Link} to={`/product/${m.product.id}?book=1`}
                    onClick={() => { if (!m.read) void act(() => getApiClient().markDemandMatchRead(m.id)) }}>
                    去预约面交
                  </Button>
                )}
                {!m.read && (
                  <Button size="small" onClick={() => void act(() => getApiClient().markDemandMatchRead(m.id))}>标记已读</Button>
                )}
                <Button size="small" color="inherit" onClick={() => void act(() => getApiClient().dismissDemandMatch(m.id))}>
                  忽略
                </Button>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

function SubscriptionManager() {
  const { currentUser } = useAuth();
  const { refresh: refreshUnread } = useDemandUnreadCount();
  const { error, success } = useNotify();
  const [items, setItems] = useState<DemandSubscription[] | null>(null);
  const [editing, setEditing] = useState<DemandSubscription | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await getApiClient().listDemandSubscriptions());
    } catch (e) {
      error(toUserMessage(e));
      setItems([]);
    }
  }, [error]);

  useEffect(() => { void load() }, [load]);

  const toggle = async (s: DemandSubscription) => {
    try {
      await getApiClient().updateDemandSubscription(s.id, { active: !s.active });
      refreshUnread();
      await load();
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  const remove = async (s: DemandSubscription) => {
    try {
      await getApiClient().deleteDemandSubscription(s.id);
      success('已删除这条订阅，历史匹配仍会保留');
      refreshUnread();
      await load();
    } catch (e) {
      error(toUserMessage(e));
    }
  };

  const saveEdit = async (conditions: DemandConditions) => {
    if (!editing) return;
    try {
      await getApiClient().updateDemandSubscription(editing.id, conditions);
      setEditing(null);
      await load();
    } catch (e) {
      setEditError(toUserMessage(e));
    }
  };

  if (items === null) return <p className="text-sm text-slate-500" role="status">加载中…</p>;
  if (items.length === 0) return <p className="rounded-2xl bg-white p-8 text-center text-slate-500">还没有订阅。</p>;

  return (
    <>
      <ul className="space-y-3" aria-label="我的订阅">
        {items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">{describeConditions(s)}</p>
              <p className="text-xs text-slate-500">已匹配 {s.matchCount} 件{s.active ? '' : ' · 已停用'}</p>
            </div>
            <div className="flex items-center gap-1">
              <Switch
                checked={s.active}
                onChange={() => void toggle(s)}
                inputProps={{ 'aria-label': `${s.active ? '停用' : '启用'}订阅：${describeConditions(s)}` }}
              />
              <Button size="small" onClick={() => { setEditError(null); setEditing(s) }}>修改</Button>
              <Button size="small" color="inherit" onClick={() => void remove(s)}>删除</Button>
            </div>
          </li>
        ))}
      </ul>
      <DemandSubscribeDialog
        open={!!editing}
        title="修改订阅条件"
        submitLabel="保存"
        initial={editing ?? {}}
        userCampus={currentUser?.campus ?? '东校区'}
        errorMessage={editError}
        onCancel={() => setEditing(null)}
        onSubmit={(c) => void saveEdit(c)}
        circleScope={editing?.circle ? { name: editing.circle.name } : null}
      />
    </>
  );
}
