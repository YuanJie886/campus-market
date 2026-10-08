import { useMemo } from 'react';
import type { Building } from '../types';
import type { MeetingPoint } from '../api/contracts';
import { rankMeetingPoints, walkMinutes } from '../utils/geo';

interface Props {
  buildings: readonly Building[];
  meetingPoints: readonly MeetingPoint[];
  /** 商品的取货楼栋 */
  productBuildingId?: string | null;
  /**
   * 当前用户的宿舍楼。<b>仅在本人浏览时传入</b>，只在这个组件内部用于计算，
   * 不写入 URL、不上报、不渲染成文字以外的任何可被他人看到的形式。
   */
  viewerBuildingId?: string | null;
  /** 用户点选某个面交点。选中只是「候选」，最终仍需在下单表单里确认。 */
  onPick?: (meetingPointId: string) => void;
  selectedMeetingPointId?: string | null;
}

const WIDTH = 320;
const HEIGHT = 220;
const PADDING = 24;

/**
 * 校园示意地图。
 *
 * <p>刻意做成轻量 SVG，而不是接入第三方地图：
 * <ul>
 *   <li>不需要 API Key，不向任何地图服务发送楼栋或面交点；</li>
 *   <li>不调用 navigator.geolocation——位置只来自用户自己填写的宿舍楼；</li>
 *   <li>坐标是演示数据，画成「示意图」比画在真实底图上更诚实，
 *       不会让人误以为这是可以照着走的导航。</li>
 * </ul>
 */
export default function CampusMap({
  buildings, meetingPoints, productBuildingId, viewerBuildingId, onPick, selectedMeetingPointId,
}: Props) {
  const productBuilding = buildings.find((b) => b.id === productBuildingId) ?? null;
  const viewerBuilding = buildings.find((b) => b.id === viewerBuildingId) ?? null;

  const ranked = useMemo(
    () => rankMeetingPoints(meetingPoints, viewerBuilding, productBuilding),
    [meetingPoints, viewerBuilding, productBuilding],
  );

  // 把经纬度线性映射到画布。示意图不需要投影精度，只需要相对位置正确。
  const projector = useMemo(() => {
    const points = [
      ...buildings.map((b) => [b.latitude, b.longitude] as const),
      ...meetingPoints.map((m) => [m.latitude, m.longitude] as const),
    ].filter((pair): pair is readonly [number, number] =>
      typeof pair[0] === 'number' && typeof pair[1] === 'number');
    if (points.length === 0) return null;
    const lats = points.map((p) => p[0]);
    const lngs = points.map((p) => p[1]);
    const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
    const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
    const spanLat = maxLat - minLat || 1e-6;
    const spanLng = maxLng - minLng || 1e-6;
    return (lat: number, lng: number) => ({
      x: PADDING + ((lng - minLng) / spanLng) * (WIDTH - 2 * PADDING),
      // SVG 的 y 轴向下，纬度向北增大，因此取反
      y: HEIGHT - PADDING - ((lat - minLat) / spanLat) * (HEIGHT - 2 * PADDING),
    });
  }, [buildings, meetingPoints]);

  const canRecommend = ranked.some((entry) => entry.recommended);
  const recommendedPoint = ranked.find((entry) => entry.recommended)?.point.name;
  // 地图的文字替代：看不见图的用户需要同样的信息——有哪些点、推荐哪一个
  const mapDescription = [
    `示意图包含 ${buildings.length} 栋楼与 ${meetingPoints.length} 个稳定面交点`,
    productBuilding ? `取货楼栋为${productBuilding.zone}${productBuilding.name}` : '商品未指定取货楼栋',
    recommendedPoint ? `推荐面交点为${recommendedPoint}` : '暂无推荐面交点',
  ].join('；') + '。下方列表可逐一选择面交点。';

  return (
    <figure className="rounded-2xl border border-slate-100 bg-white p-3" aria-label="校园示意地图">
      {projector ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full max-w-full"
          role="img"
          aria-label="楼栋与稳定面交点的相对位置示意"
          aria-describedby="campus-map-description"
        >
          <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="12" fill="#f5f7f6" />
          {buildings.map((b) => {
            if (typeof b.latitude !== 'number' || typeof b.longitude !== 'number') return null;
            const { x, y } = projector(b.latitude, b.longitude);
            const isProduct = b.id === productBuildingId;
            const isViewer = b.id === viewerBuildingId;
            return (
              <g key={b.id} data-testid={`map-building-${b.id}`}>
                <rect
                  x={x - 7} y={y - 7} width="14" height="14" rx="3"
                  fill={isProduct ? '#2f6f4f' : isViewer ? '#3b6ea5' : '#cbd5d1'}
                />
                {(isProduct || isViewer) && (
                  <text x={x + 10} y={y + 4} fontSize="10" fill="#334155">
                    {b.zone}{b.name}
                  </text>
                )}
              </g>
            );
          })}
          {meetingPoints.map((m) => {
            if (typeof m.latitude !== 'number' || typeof m.longitude !== 'number') return null;
            const { x, y } = projector(m.latitude, m.longitude);
            const recommended = ranked.find((r) => r.point.id === m.id)?.recommended;
            const selected = selectedMeetingPointId === m.id;
            return (
              <g key={m.id} data-testid={`map-point-${m.id}`}>
                <circle
                  cx={x} cy={y} r={selected ? 8 : 6}
                  fill={recommended ? '#d97706' : '#ffffff'}
                  stroke={selected ? '#0f172a' : '#d97706'}
                  strokeWidth="2"
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="p-4 text-sm text-slate-500">暂无可绘制的坐标，下面按原有顺序列出面交点。</p>
      )}

      <p id="campus-map-description" className="sr-only">{mapDescription}</p>

      {/* 图例。色块纯属装饰，已有文字说明，对读屏隐藏 */}
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span><span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#2f6f4f] align-middle" />取货楼栋</span>
        {viewerBuilding && (
          <span><span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#3b6ea5] align-middle" />我的宿舍楼</span>
        )}
        <span><span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-[#d97706] align-middle" />稳定面交点</span>
        {canRecommend && (
          <span><span aria-hidden="true" className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#d97706] align-middle" />推荐</span>
        )}
      </figcaption>

      <ul className="mt-3 space-y-1.5" aria-label="稳定面交点">
        {ranked.map(({ point, totalMeters, recommended }) => (
          <li key={point.id}>
            <button
              type="button"
              onClick={() => onPick?.(point.id)}
              aria-pressed={selectedMeetingPointId === point.id}
              className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <span>
                {point.name}
                {recommended && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">推荐</span>
                )}
              </span>
              {totalMeters !== null && (
                <span className="text-xs text-slate-500">两人合计步行约 {walkMinutes(totalMeters)} 分钟</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-slate-500">
        {canRecommend
          ? '距离为直线估算，实际路线以校园道路为准。推荐仅供参考，面交点需要你在下单时确认。'
          : '缺少楼栋坐标，无法估算距离，面交点按默认顺序展示。面交点需要你在下单时确认。'}
      </p>
    </figure>
  );
}
