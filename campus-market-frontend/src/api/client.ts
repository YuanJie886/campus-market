import type { CampusMarketApi } from './contracts';
import { HttpTransport } from './httpTransport';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
/**
 * 构建期常量比较：Vite 把 import.meta.env.VITE_API_MODE 替换成字面量，REST 构建里这个条件折叠为 false，
 * MockCampusMarketApi（连同演示种子数据）因此不会进入 REST 的入口 chunk。
 * 之前写成 `(VITE_API_MODE ?? 'rest').toLowerCase()`，方法调用无法常量折叠，整个离线 Mock 都被打进了 REST 包。
 */
const MOCK_MODE = import.meta.env.VITE_API_MODE === 'mock' || import.meta.env.VITE_API_MODE === 'MOCK';

export function createApiClient(): CampusMarketApi {
  if (MOCK_MODE) return new MockCampusMarketApi();
  return new RestCampusMarketApi(new HttpTransport({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '', timeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 10000) }));
}
let apiClient: CampusMarketApi | null = null;
export function getApiClient(): CampusMarketApi { if (!apiClient) apiClient = createApiClient(); return apiClient }
export function setApiClient(client: CampusMarketApi): void { apiClient = client }
