import type { CampusMarketApi } from './contracts';
import { HttpTransport } from './httpTransport';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { TokenStore } from '../utils/tokenStore';
export function createApiClient(): CampusMarketApi {
  const tokenStore = new TokenStore();
  const mode = (import.meta.env.VITE_API_MODE ?? 'rest').toLowerCase();
  if (mode !== 'mock') return new RestCampusMarketApi(new HttpTransport({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '', timeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 10000), tokenStore }), tokenStore);
  return new MockCampusMarketApi(tokenStore);
}
let apiClient: CampusMarketApi | null = null;
export function getApiClient(): CampusMarketApi { if (!apiClient) apiClient = createApiClient(); return apiClient }
export function setApiClient(client: CampusMarketApi): void { apiClient = client }
