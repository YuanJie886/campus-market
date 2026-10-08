import { Alert, Button, FormControlLabel, Switch } from '@mui/material';
import { Link } from 'react-router-dom';
import type { BuildingFeedState } from '../hooks/useBuildingFeed';

interface Props {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  feed: BuildingFeedState;
}

/**
 * 首页常驻的「只看本楼」开关与状态提示。
 *
 * <p>刻意放在筛选区最显眼的位置，而不是折叠进高级筛选：楼栋自提是这个产品
 * 与通用二手平台的核心差别，藏起来等于没有。
 *
 * <p>提示分四种且互不混淆：需要登录 / 需要设置宿舍楼 / 已自动降级 / 真的没有。
 * 其中「已降级」是非阻塞的浅提示——用户要的是看到商品，不是先关掉一个弹窗。
 */
export default function BuildingScopeBar({ enabled, onToggle, feed }: Props) {
  const page = feed.page;

  return (
    // 状态提示放在一个 polite 的 live region 里：读屏会在用户空闲时播报「已为你展示本园区」，
    // 而不是像 role="alert" 那样每次筛选都打断用户。错误提示保留 alert 语义。
    <div className="mb-3 space-y-2">
      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
            inputProps={{ 'aria-label': '只看本楼' }}
          />
        }
        label="只看本楼"
      />

      {feed.action === 'login' && (
        <Alert
          severity="info"
          role="status"
          action={
            <Button component={Link} to="/login" size="small">
              去登录
            </Button>
          }
        >
          登录后才能知道你住哪栋楼。我们不会自动定位，也不会替你猜。
        </Alert>
      )}

      {feed.action === 'set-dorm-building' && (
        <Alert
          severity="info"
          role="status"
          action={
            <Button component={Link} to="/profile" size="small">
              去设置
            </Button>
          }
        >
          还没有填写宿舍楼。填写后即可只看本楼的闲置；只需要楼栋，不需要房间号。
        </Alert>
      )}

      {feed.status === 'error' && !feed.action && (
        <Alert
          severity="warning"
          action={
            <Button size="small" onClick={feed.reload}>
              重试
            </Button>
          }
        >
          {feed.errorMessage}
        </Alert>
      )}

      {/* 自动降级：非阻塞地说明「你看到的其实是哪一级」，避免用户误以为本楼真有这么多 */}
      {feed.status === 'ready' && page?.fallbackApplied && page.total > 0 && (
        <Alert severity="info" variant="outlined" role="status" aria-live="polite">
          本楼暂无匹配，已为你展示{page.effectiveScopeLabel}的商品（筛选条件保持不变）。
        </Alert>
      )}

      {feed.status === 'ready' && page?.total === 0 && (
        <Alert severity="info" variant="outlined" role="status" aria-live="polite">
          全校都没有符合条件的商品。试着放宽筛选，或发布一条求购。
        </Alert>
      )}
    </div>
  );
}
