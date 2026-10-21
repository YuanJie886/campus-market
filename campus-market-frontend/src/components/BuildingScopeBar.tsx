import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { BuildingFeedState } from '../hooks/useBuildingFeed';
import {
  DORM_NEEDED,
  LOGIN_NEEDED,
  MARKET_SCOPES,
  feedNotice,
  type MarketScope,
} from '../utils/marketScope';

interface SwitchProps {
  value: MarketScope;
  onChange: (next: MarketScope) => void;
  /** 可选的范围（默认全部三项）。本人校区还没有楼栋时首页不提供「本楼」 */
  scopes?: readonly { key: MarketScope; label: string }[];
}

/**
 * 范围切换：本楼 / 本校区 / 全校（与小程序集市页的分段控件相同）。
 *
 * <p>用原生单选框实现单选组：读屏念出「商品范围，单选组，本楼，1/3」；Tab 进入当前项，
 * 方向键在三项之间移动并立即切换——这是单选组的标准键盘模型，不需要自己维护 roving tabindex。
 */
export function ScopeSwitch({ value, onChange, scopes = MARKET_SCOPES }: SwitchProps) {
  // 原生单选框的方向键行为在各浏览器一致；这里只补上 Home / End
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const target = event.key === 'Home' ? scopes[0] : scopes[scopes.length - 1];
    onChange(target.key);
    event.currentTarget.querySelector<HTMLInputElement>(`input[value="${target.key}"]`)?.focus();
  };

  return (
    <div className="cm-scope" role="radiogroup" aria-label="商品范围" onKeyDown={onKeyDown}>
      {scopes.map((scope) => (
        <label key={scope.key} className="cm-scope-option">
          <input
            type="radio"
            name="market-scope"
            value={scope.key}
            checked={value === scope.key}
            onChange={() => onChange(scope.key)}
          />
          <span>{scope.label}</span>
        </label>
      ))}
    </div>
  );
}

interface NoticeProps {
  feed: BuildingFeedState;
}

/**
 * 范围提示，四种且互不混淆：需要登录 / 需要设置宿舍楼 / 已自动放宽 / 全校都没有。
 * 「已放宽」是非阻塞的浅提示——用户要的是看到商品，不是先关掉一个弹窗；
 * 因此放在 polite 的 status 区域里，读屏在用户空闲时播报，而不是每次筛选都打断。
 */
export function ScopeNotice({ feed }: NoticeProps) {
  const notice = feed.status === 'ready' ? feedNotice(feed.page) : '';

  if (feed.action === 'login') {
    return (
      <div className="cm-notice" role="status">
        <span>{LOGIN_NEEDED}</span>
        <Link to="/login" className="cm-notice-action">去登录</Link>
      </div>
    );
  }
  if (feed.action === 'set-dorm-building') {
    return (
      <div className="cm-notice" role="status">
        <span>{DORM_NEEDED}</span>
        <Link to="/profile" className="cm-notice-action">去设置</Link>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className={notice ? 'cm-notice' : 'cm-visually-hidden'}>
      {notice}
    </div>
  );
}

/** 首页范围条：分段控件 + 提示。保留默认导出，方便单独渲染与测试。 */
export default function BuildingScopeBar({ value, onChange, feed, scopes }: SwitchProps & NoticeProps) {
  return (
    <div className="cm-scope-bar">
      <ScopeSwitch value={value} onChange={onChange} scopes={scopes} />
      <ScopeNotice feed={feed} />
    </div>
  );
}
