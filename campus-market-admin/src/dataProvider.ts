import type { DataProvider, GetListParams, GetManyParams, Identifier, RaRecord } from 'react-admin';
import { HttpError } from './HttpError';
import { request } from './http';

const RESOURCES = new Set(['users', 'products', 'orders', 'cases', 'appeals', 'audit', 'role-requests', 'read-audit', 'roles', 'registration-invites']);
/** 与后端 AdminService.rejectQuery 一致：每个资源只发送它接受的筛选参数。 */
const FILTERS: Record<string, string[]> = { cases: ['status', 'targetType'], appeals: ['status'], products: ['q', 'status', 'category', 'campus', 'moderationHidden'], 'role-requests': ['q', 'status'], 'registration-invites': ['status'] };
const queueResources = new Set(['cases', 'appeals']);
/**
 * 按 page / size 分页的资源及其每页上限。注册邀请码接口（GET /v1/admin/registration-invites）的契约是
 * page + size（最多 50）+ status，不接受 perPage / sort / order / q。
 */
export const SIZE_PAGED: Readonly<Record<string, number>> = { 'registration-invites': 50 };
function base(resource: string) {
    if (!RESOURCES.has(resource)) throw new HttpError('不支持的后台资源', 400);
    return `/v1/admin/${resource}`;
}
export function listQuery(resource: string, params: GetListParams): string {
    const page = String(params.pagination?.page ?? 1), perPage = params.pagination?.perPage ?? 25;
    const sizeLimit = SIZE_PAGED[resource];
    const query = sizeLimit
        ? new URLSearchParams({ page, size: String(Math.min(Math.max(1, perPage), sizeLimit)) })
        : new URLSearchParams({ page, perPage: String(perPage) });
    if (!sizeLimit && !queueResources.has(resource) && resource !== 'roles') {
        query.set('sort', params.sort?.field ?? 'createdAt'); query.set('order', params.sort?.order ?? 'DESC');
    }
    const allowed = FILTERS[resource] ?? ['q'];
    for (const key of allowed) if (params.filter?.[key] !== undefined && params.filter[key] !== null && params.filter[key] !== '') query.set(key, String(params.filter[key]));
    return query.toString();
}
function path(resource: string, id: Identifier) { return `${base(resource)}/${encodeURIComponent(String(id))}`; }
const unsupported = () => Promise.reject(new HttpError('此后台不支持直接创建或删除业务记录', 405));
export const dataProvider: DataProvider = {
    async getList<RecordType extends RaRecord>(resource: string, params: GetListParams) {
        const page = await request<{ items: RecordType[]; total?: number | null }>(`${base(resource)}?${listQuery(resource, params)}`);
        if (typeof page.total === 'number') return { data: page.items, total: page.total };
        // 没有返回总数（注册邀请码契约中 total 可选）：按这一页是否取满判断还有没有下一页。
        const current = params.pagination?.page ?? 1, perPage = params.pagination?.perPage ?? 25;
        return { data: page.items, pageInfo: { hasPreviousPage: current > 1, hasNextPage: page.items.length >= Math.min(perPage, SIZE_PAGED[resource] ?? perPage) } };
    },
    async getOne(resource, { id }) {
        // 读取审计只有列表（后端详情接口返回 404），不发请求。
        if (resource === 'read-audit') throw new HttpError('读取审计只提供列表', 404);
        return { data: await request(path(resource, id)) };
    },
    async getMany<RecordType extends RaRecord>(resource: string, { ids }: GetManyParams) {
        if (ids.length > 100) throw new HttpError('单次最多读取 100 条记录', 400);
        return { data: await Promise.all(ids.map(id => request<RecordType>(path(resource, id)))) };
    },
    getManyReference: unsupported,
    create: unsupported,
    delete: unsupported,
    deleteMany: unsupported,
    updateMany: unsupported,
    async update(resource, { id, data }) {
        if (resource === 'products') {
            const { title, description, price, note, version } = data;
            return { data: await request(path(resource, id), { method: 'PATCH', body: JSON.stringify({ title, description, price, note, version }) }) };
        }
        if (resource === 'users') {
            const { role, active, note } = data;
            return { data: await request(`${path(resource, id)}/staff`, { method: 'PATCH', body: JSON.stringify({ role, active, note }) }) };
        }
        if (resource === 'cases') {
            const { action, reasonCode, note, durationHours } = data;
            return { data: await request(`${path(resource, id)}/decision`, { method: 'POST', body: JSON.stringify({ action, reasonCode, note, durationHours }) }) };
        }
        if (resource === 'orders') throw new HttpError('历史订单只读：站内交易已停用，订单不能修改', 405);
        // 复核请求只能通过确认 / 驳回 / 撤回接口处理（见 roleRequestDecision），内容不可改。
        throw new HttpError('此资源只供查看', 405);
    },
};

export type RoleRequestDecision = 'approve' | 'reject' | 'cancel';
/**
 * 处理一条人员变更复核请求：POST /v1/admin/role-requests/{id}/{approve|reject|cancel}。
 * 确认与驳回必须写明 1～500 字理由；撤回的理由可选，不填时不发送请求体。
 */
export function roleRequestDecision(id: Identifier, decision: RoleRequestDecision, note?: string) {
    const text = note?.trim() ?? '';
    if (decision !== 'cancel' && !text) return Promise.reject(new HttpError('请写明确认或驳回的理由', 400));
    if (text.length > 500) return Promise.reject(new HttpError('理由最多 500 字', 400));
    return request<RaRecord>(`${path('role-requests', id)}/${decision}`, { method: 'POST', ...(text ? { body: JSON.stringify({ note: text }) } : {}) });
}
