import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Box, Button, Card, CardContent, Chip, Divider, Rating, Skeleton, Typography } from '@mui/material';
import ProductIcon from '@mui/icons-material/Inventory2Outlined';
import PersonIcon from '@mui/icons-material/PersonOutline';
import ArrowIcon from '@mui/icons-material/ArrowForward';
import { List, Show, DatagridConfigurable, DateField, NumberField, TextInput, ShowButton, useRecordContext, useShowContext, type FieldProps, type RaRecord } from 'react-admin';
import { ListActions, ListSummary } from './ListTools';
import { IdentifierField, PageHeading, StatusBadge, StatusField, statusNames } from './adminUi';

interface OrderEvent { id: string; actorId?: string; actorNickname?: string; fromStatus?: string; toStatus?: string; eventCode: string; reason?: string; createdAt: number; meetingRevision?: number }
interface OrderReview { id: string; reviewerId: string; reviewerNickname: string; rating: number; comment?: string; createdAt: number }
interface BundleItem { id: string; name: string; category: string; condition: string; quantity: number; note?: string }
interface OrderRecord extends RaRecord {
    productId: string; productTitle?: string; productImage?: string; productImages?: string[]; productDescription?: string;
    productCategory?: string; productCondition?: string; productStatus?: string; productCampus?: string; productCurrentPrice?: number; productListingKind?: string;
    price?: number; priceSnapshot?: number | null; currency?: string; status: string;
    categorySnapshot?: string; conditionSnapshot?: string; listingKindSnapshot?: string;
    buyerId: string; buyerNickname?: string; buyerAccount?: string; buyerCampus?: string; buyerAvatar?: string;
    sellerId: string; sellerNickname?: string; sellerAccount?: string; sellerCampus?: string; sellerAvatar?: string;
    meetingPointId?: string; meetingPointName?: string; meetingCampus?: string; meetingAt?: number; meetingEndsAt?: number; meetingRevision?: number;
    createdAt?: number; updatedAt?: number; expiresAt?: number;
    events?: OrderEvent[]; reviews?: OrderReview[]; bundleItems?: BundleItem[];
    cancellation?: { actorId: string; reasonCode?: string; note?: string; phase: string; createdAt: number };
}
const money = (value?: number | null) => value == null ? '未记录' : new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
const time = (value?: number | null) => value == null ? '未记录' : new Date(value).toLocaleString('zh-CN', { hour12: false });
const listingName = (value?: string) => value === 'BUNDLE' ? '整套打包' : value === 'SINGLE' ? '单件商品' : '未记录';
const preferenceKey = 'orders.transaction-details.v2';
function ProductCell(_: FieldProps) {
    const record = useRecordContext<OrderRecord>();
    if (!record) return null;
    return <Box className="order-product-cell"><Avatar src={record.productImage || undefined} variant="rounded" className="order-thumbnail"><ProductIcon fontSize="small" /></Avatar><Box><Typography sx={{ fontWeight: 600, fontSize: 12 }}>{record.productTitle || '商品信息未提供'}</Typography><Typography sx={{ mt: .6, fontSize: 11 }} color="text.secondary">{[record.productCategory, record.productCampus].filter(Boolean).join(' · ') || record.productId}</Typography></Box></Box>;
}
function PartyCell({ side }: FieldProps & { side: 'buyer' | 'seller' }) {
    const record = useRecordContext<OrderRecord>(); if (!record) return null;
    const nickname = record[`${side}Nickname`];
    return <Box className="order-party-cell"><Avatar src={record[`${side}Avatar`] || undefined} sx={{ width: 28, height: 28, bgcolor: side === 'buyer' ? '#e5f0ea' : '#edf0f9', color: side === 'buyer' ? '#4a7b5e' : '#737eab', fontSize: 12 }}>{nickname?.slice(0, 1) || <PersonIcon fontSize="small" />}</Avatar><Box><Typography sx={{ fontSize: 12, fontWeight: 600 }}>{nickname || '用户信息未提供'}</Typography><Typography sx={{ fontSize: 10, mt: .5 }} color="text.secondary">{record[`${side}Account`] || record[`${side}Id`]}</Typography></Box></Box>;
}
export function OrdersList() {
    return <><PageHeading title="交易订单" description="查看商品、交易双方、成交金额与面交安排，点击订单查看完整记录。" eyebrow="TRANSACTIONS / 交易管理" />
        <List actions={<ListActions preferenceKey={preferenceKey} />} perPage={25} sort={{ field: 'createdAt', order: 'DESC' }} filters={[<TextInput key="q" source="q" label="搜索订单、商品、买家或卖家" alwaysOn resettable inputProps={{ maxLength: 100 }} sx={{ minWidth: { sm: 290 } }} />]}>
            <ListSummary /><DatagridConfigurable preferenceKey={preferenceKey} bulkActionButtons={false} rowClick="show" sx={{ '& .RaDatagrid-table': { minWidth: 1050 } }}>
                <ProductCell source="productTitle" label="交易商品" sortable={false} />
                <PartyCell side="buyer" source="buyerNickname" label="买家" sortable={false} />
                <PartyCell side="seller" source="sellerNickname" label="卖家" sortable={false} />
                <NumberField locales="zh-CN" source="price" label="交易金额" options={{ style: 'currency', currency: 'CNY' }} emptyText="未记录" />
                <StatusField source="status" label="订单状态" sortable={false} />
                <DateField locales="zh-CN" source="createdAt" label="下单时间" showTime />
                <IdentifierField source="id" label="订单编号" />
                <ShowButton label="详情" />
            </DatagridConfigurable>
        </List>
    </>;
}
function Info({ label, children }: { label: string; children?: ReactNode }) { return <Box className="order-info"><Typography>{label}</Typography><Box>{children ?? '未记录'}</Box></Box>; }
function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) { return <Card><CardContent sx={{ p: { xs: 2.5, sm: 3 } }}><Typography variant="h6">{title}</Typography>{caption && <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: .75 }}>{caption}</Typography>}<Divider sx={{ my: 2 }} />{children}</CardContent></Card>; }
function PartyDetails({ record, side }: { record: OrderRecord; side: 'buyer' | 'seller' }) {
    return <Box className="order-party-detail"><Box className="order-party-heading"><Avatar src={record[`${side}Avatar`] || undefined} sx={{ bgcolor: '#e6f1e9', color: '#4c7c60' }}>{record[`${side}Nickname`]?.slice(0, 1) || <PersonIcon />}</Avatar><Box><Typography color="text.secondary" sx={{ fontSize: 11 }}>{side === 'buyer' ? '买家' : '卖家'}</Typography><Typography variant="h6" sx={{ mt: .3 }}>{record[`${side}Nickname`] || '用户信息未提供'}</Typography></Box></Box><Info label="校园账号">{record[`${side}Account`]}</Info><Info label="所在校区">{record[`${side}Campus`]}</Info><Info label="用户编号"><Typography component="span" sx={{ fontSize: 11, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{record[`${side}Id`]}</Typography></Info></Box>;
}
const flowNames: Record<string, string> = { MEETING_PROPOSED: '提出改约', MEETING_ACCEPTED: '接受改约', MEETING_REJECTED: '拒绝改约', MEETING_WITHDRAWN: '撤回改约', PRESENCE_DEPARTED: '已出发', PRESENCE_ARRIVED: '已到达', INSPECTION_SUBMITTED: '提交验货结果', INSPECTION_MISMATCH: '验货不符' };
const cancelReasons: Record<string, string> = { CHANGED_MIND: '改变购买意愿', SCHEDULE_CONFLICT: '时间冲突', ITEM_UNAVAILABLE: '商品无法交付', CONDITION_MISMATCH: '商品状况不符', COUNTERPART_UNRESPONSIVE: '对方未回应', OTHER: '其他原因' };
const cancelPhases: Record<string, string> = { BEFORE_SELLER_CONFIRM: '卖家确认前', AFTER_SELLER_CONFIRM: '卖家确认后', AFTER_MEETING_AGREED: '面交安排确认后', AFTER_ARRIVAL_REPORTED: '报告到达后', INSPECTION_MISMATCH: '验货不符后' };
function actorLabel(record: OrderRecord, actorId?: string) { return !actorId ? '系统' : actorId === record.buyerId ? '买家' : actorId === record.sellerId ? '卖家' : '工作人员'; }
function OrderDetails() {
    const record = useRecordContext<OrderRecord>(); const { isFetching } = useShowContext();
    if (!record) return <Skeleton variant="rounded" height={400} />;
    const productImages = record.productImages ?? (record.productImage ? [record.productImage] : []);
    return <Box className="order-detail-layout">
        <Card className="order-overview"><CardContent sx={{ p: 3 }}><Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}><Box><Typography className="eyebrow">ORDER / 订单摘要</Typography><Typography sx={{ fontSize: 12, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{record.id}</Typography></Box><StatusBadge value={record.status} /></Box><Divider sx={{ my: 2.5 }} /><Box className="order-overview-grid"><Info label="订单成交金额"><Typography sx={{ fontSize: 28, fontWeight: 700, color: '#157657' }}>{money(record.price)}</Typography></Info><Info label="下单时间">{time(record.createdAt)}</Info><Info label="最近更新">{time(record.updatedAt)}</Info><Info label="预约有效期">{time(record.expiresAt)}</Info></Box></CardContent></Card>
        <Box className="order-detail-columns"><Box sx={{ minWidth: 0, display: 'grid', gap: 3, alignContent: 'start' }}>
            <Section title="交易商品" caption="名称、图片与描述展示商品当前信息；成交金额取自订单记录。">
                <Box className="order-product-detail"><Avatar variant="rounded" src={productImages[0]} className="order-detail-image"><ProductIcon sx={{ fontSize: 34 }} /></Avatar><Box sx={{ minWidth: 0 }}><Typography variant="h5" sx={{ mb: 1 }}>{record.productTitle || '商品信息未提供'}</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}><Chip size="small" label={record.productCategory ?? '分类未记录'} /><Chip size="small" label={record.productCondition ?? '成色未记录'} /><Chip size="small" label={listingName(record.productListingKind)} />{record.productStatus && <StatusBadge value={record.productStatus} />}</Box><Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 2 }}>当前售价：{money(record.productCurrentPrice)} · {record.productCampus ?? '校区未记录'}</Typography></Box></Box>
                <Typography sx={{ fontSize: 13, lineHeight: 1.9, mt: 2.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.productDescription || '暂无商品描述'}</Typography>
                {productImages.length > 1 && <Box className="order-image-gallery">{productImages.map((src, index) => <Box component="img" key={`${src}-${index}`} src={src} alt={`商品图片 ${index + 1}`} loading="lazy" />)}</Box>}
                <Box sx={{ mt: 2 }}><Info label="商品编号"><Typography sx={{ fontFamily: 'monospace', fontSize: 11, overflowWrap: 'anywhere' }}>{record.productId}</Typography></Info></Box>
                {Boolean(record.bundleItems?.length) && <Box sx={{ mt: 2.5 }}><Typography variant="h6" sx={{ mb: 1.5 }}>打包明细</Typography>{record.bundleItems!.map(item => <Box key={item.id} className="order-bundle-row"><Box><Typography sx={{ fontSize: 12, fontWeight: 600 }}>{item.name} × {item.quantity}</Typography><Typography sx={{ fontSize: 11, color: 'text.secondary', mt: .5 }}>{item.category} · {item.condition}{item.note ? ` · ${item.note}` : ''}</Typography></Box></Box>)}</Box>}
            </Section>
            <Section title="交易双方"><Box className="order-parties-grid"><PartyDetails record={record} side="buyer" /><PartyDetails record={record} side="seller" /></Box></Section>
            <Section title="交易记录" caption="订单状态、改约、到达和验货事件，按发生时间排列。">
                {isFetching && !record.events ? <Skeleton height={100} /> : !record.events?.length ? <Typography color="text.secondary" sx={{ fontSize: 12 }}>暂无交易记录</Typography> : <Box className="order-timeline">{record.events.map(event => <Box key={event.id} className="order-timeline-item"><Box className="order-timeline-dot" /><Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ fontWeight: 600, fontSize: 12 }}>{event.eventCode === 'STATUS_CHANGED' ? (event.fromStatus ? `${statusNames[event.fromStatus] ?? event.fromStatus} → ${statusNames[event.toStatus ?? ''] ?? event.toStatus}` : '买家创建订单') : flowNames[event.eventCode] ?? event.eventCode}</Typography><Typography sx={{ color: 'text.secondary', fontSize: 11, mt: .75 }}>{time(event.createdAt)} · {actorLabel(record, event.actorId)}{event.actorNickname ? ` ${event.actorNickname}` : ''}{event.meetingRevision != null ? ` · 第 ${event.meetingRevision} 版面交安排` : ''}</Typography>{event.reason && <Typography sx={{ fontSize: 12, mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{event.reason}</Typography>}</Box></Box>)}</Box>}
            </Section>
            <Section title="交易评价">{!record.reviews?.length ? <Typography sx={{ fontSize: 12 }} color="text.secondary">暂无交易评价</Typography> : record.reviews.map(review => <Box key={review.id} sx={{ mb: 2 }}><Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}><Typography sx={{ fontSize: 12, fontWeight: 600 }}>{actorLabel(record, review.reviewerId)} · {review.reviewerNickname}</Typography><Rating value={review.rating} readOnly size="small" /></Box><Typography sx={{ fontSize: 12, lineHeight: 1.8, my: 1 }}>{review.comment || '未填写评价内容'}</Typography><Typography sx={{ fontSize: 11 }} color="text.secondary">{time(review.createdAt)}</Typography></Box>)}</Section>
        </Box><Box sx={{ minWidth: 0, display: 'grid', gap: 3, alignContent: 'start' }}>
            <Section title="面交安排"><Info label="面交地点">{record.meetingPointName ?? record.meetingPointId}</Info><Info label="面交校区">{record.meetingCampus}</Info><Info label="开始时间">{time(record.meetingAt)}</Info><Info label="结束时间">{time(record.meetingEndsAt)}</Info><Info label="改约次数">{record.meetingRevision == null ? '未记录' : `${record.meetingRevision} 次`}</Info></Section>
            <Section title="下单时交易信息" caption="展示订单保存的成交快照；旧订单没有保存的字段显示为未记录。"><Info label="成交金额">{money(record.price)}</Info><Info label="商品分类">{record.categorySnapshot}</Info><Info label="商品成色">{record.conditionSnapshot}</Info><Info label="交易形态">{listingName(record.listingKindSnapshot)}</Info></Section>
            {record.cancellation && <Section title="取消说明"><Info label="操作方">{actorLabel(record, record.cancellation.actorId)}</Info><Info label="取消阶段">{cancelPhases[record.cancellation.phase] ?? record.cancellation.phase}</Info><Info label="取消原因">{cancelReasons[record.cancellation.reasonCode ?? ''] ?? record.cancellation.reasonCode}</Info><Info label="补充说明">{record.cancellation.note || '无补充说明'}</Info><Info label="取消时间">{time(record.cancellation.createdAt)}</Info></Section>}
        </Box></Box>
    </Box>;
}
export function OrderShow() {
    return <><PageHeading title="订单详情" description="查看交易商品、买卖双方、面交安排和完整交易记录。" eyebrow="ORDER DETAILS / 交易详情" action={<Button component={Link} to="/orders" variant="outlined" sx={{ flexShrink: 0, whiteSpace: 'nowrap' }} startIcon={<ArrowIcon sx={{ transform: 'rotate(180deg)' }} />}>返回订单</Button>} />
        <Show component="div" actions={false} title="订单详情"><OrderDetails /></Show>
    </>;
}
