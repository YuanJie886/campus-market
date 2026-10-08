import type { DataProvider, GetListParams, GetManyParams, Identifier, RaRecord } from 'react-admin';
import { HttpError } from './HttpError';
import { request } from './http';

const RESOURCES = new Set(['users', 'products', 'orders', 'cases', 'appeals', 'audit', 'roles']);
const queueResources = new Set(['cases', 'appeals']);
function base(resource: string) {
    if (!RESOURCES.has(resource)) throw new HttpError('不支持的后台资源', 400);
    return `/v1/admin/${resource}`;
}
export function listQuery(resource: string, params: GetListParams): string {
    const query = new URLSearchParams({ page: String(params.pagination?.page ?? 1), perPage: String(params.pagination?.perPage ?? 25) });
    if (!queueResources.has(resource) && resource !== 'roles') {
        query.set('sort', params.sort?.field ?? 'createdAt'); query.set('order', params.sort?.order ?? 'DESC');
    }
    const allowed = queueResources.has(resource) ? (resource === 'cases' ? ['status', 'targetType'] : ['status']) : resource === 'products' ? ['q', 'status', 'category', 'campus', 'moderationHidden'] : ['q'];
    for (const key of allowed) if (params.filter?.[key] !== undefined && params.filter[key] !== null && params.filter[key] !== '') query.set(key, String(params.filter[key]));
    return query.toString();
}
function path(resource: string, id: Identifier) { return `${base(resource)}/${encodeURIComponent(String(id))}`; }
const unsupported = () => Promise.reject(new HttpError('此后台不支持直接创建或删除业务记录', 405));
export const dataProvider: DataProvider = {
    async getList<RecordType extends RaRecord>(resource: string, params: GetListParams) {
        const page = await request<{ items: RecordType[]; total: number }>(`${base(resource)}?${listQuery(resource, params)}`);
        return { data: page.items, total: page.total };
    },
    async getOne(resource, { id }) { return { data: await request(path(resource, id)) }; },
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
        throw new HttpError('此资源只供查看', 405);
    },
};
