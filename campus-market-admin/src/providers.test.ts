import { afterEach, describe, expect, it, vi } from 'vitest';
import { listQuery, dataProvider } from './dataProvider';
import { authProvider, permissionFor } from './authProvider';
import { request, clearSession, acceptSession, hasAccessToken } from './http';
import queryString, { parse, stringify } from './queryStringCompat';

afterEach(() => { clearSession(); vi.unstubAllGlobals(); });
describe('管理后台适配', () => {
    it('没有访问令牌时退出不依赖后端，允许框架跳转到登录页', async () => {
        const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', fetch);
        await expect(authProvider.logout({})).resolves.toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });
    it('主动退出遇到服务错误保留会话，服务器确认已失效则清除', async () => {
        acceptSession({ accessToken: 'session', expiresAtIso: '2099-01-01' });
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ code: 500, message: '服务不可用' }), { status: 500 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ code: 401, message: '会话失效' }), { status: 401 }));
        vi.stubGlobal('fetch', fetch);
        await expect(authProvider.logout({})).rejects.toMatchObject({ status: 500 });
        expect(hasAccessToken()).toBe(true);
        await authProvider.logout({});
        expect(hasAccessToken()).toBe(false);
    });
    it('升级后的查询解析兼容 React-admin 筛选和中文内容', () => {
        const value = { filter: JSON.stringify({ q: '校园闲置' }), page: '2', sort: 'createdAt', order: 'DESC' };
        expect(queryString.parse(queryString.stringify(value))).toEqual(value);
        expect(parse(stringify(value))).toEqual(value);
    });
    it('队列使用已有状态筛选，不发送通用排序或搜索参数', () => {
        const query = listQuery('cases', { pagination: { page: 2, perPage: 25 }, sort: { field: 'id', order: 'ASC' }, filter: { status: 'OPEN', q: 'ignored', schoolId: 'forged' } });
        expect(query).toBe('page=2&perPage=25&status=OPEN');
    });
    it('不开放创建和删除权限', () => {
        expect(permissionFor('users', 'edit')).toBe('users:write');
        expect(permissionFor('users', 'delete')).toBeNull();
        expect(permissionFor('orders', 'create')).toBeNull();
    });
    it('授权提交只含允许字段，不能把整个用户记录回传', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { id: 'u' } })));
        vi.stubGlobal('fetch', fetch);
        await dataProvider.update('users', { id: 'u', data: { role: 'AUDITOR', active: true, note: '工作需要', account: 'tamper', schoolId: 'other' }, previousData: { id: 'u' } });
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ role: 'AUDITOR', active: true, note: '工作需要' });
    });
    it('403 不重试或刷新会话', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 403, message: '没有权限' }), { status: 403 }));
        vi.stubGlobal('fetch', fetch);
        await expect(request('/v1/admin/users')).rejects.toMatchObject({ status: 403 });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('并发 401 只刷新一次，失败请求最多重试一次', async () => {
        vi.stubGlobal('navigator', {});
        let refreshCount = 0;
        const fetch = vi.fn(async (path: string, init: RequestInit) => {
            if (path === '/v1/auth/refresh') {
                refreshCount++;
                return new Response(JSON.stringify({ code: 0, data: { accessToken: 'fresh', expiresAtIso: '2099-01-01' } }));
            }
            if (!new Headers(init.headers).has('Authorization')) return new Response(JSON.stringify({ code: 401 }), { status: 401 });
            return new Response(JSON.stringify({ code: 0, data: { id: 'u' } }));
        });
        vi.stubGlobal('fetch', fetch);
        await Promise.all([request('/v1/admin/users'), request('/v1/admin/products')]);
        expect(refreshCount).toBe(1);
        expect(fetch).toHaveBeenCalledTimes(5);
    });
});
