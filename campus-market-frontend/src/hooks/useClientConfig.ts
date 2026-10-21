import { useEffect, useState } from 'react';
import { getApiClient } from '../api/client';
import { DEFAULT_CLIENT_CONFIG, normalizeClientConfig, type CampusMarketApi, type ClientConfig } from '../api/contracts';

/**
 * GET /v1/config 只请求一次：按当前 API 客户端缓存同一个 Promise（测试里 setApiClient 换客户端时自然重新请求）。
 * 请求失败（网络错误、5xx）时不缓存失败结果，下次挂载再试；旧后端的 404 已在 REST 适配层换成默认值。
 */
const cache = new WeakMap<CampusMarketApi, Promise<ClientConfig>>();
const resolved = new WeakMap<CampusMarketApi, ClientConfig>();

export function loadClientConfig(api: CampusMarketApi = getApiClient()): Promise<ClientConfig> {
  let pending = cache.get(api);
  if (!pending) {
    pending = (typeof api.getClientConfig === 'function' ? api.getClientConfig() : Promise.resolve(DEFAULT_CLIENT_CONFIG))
      .then((config) => {
        const normalized = normalizeClientConfig(config);
        resolved.set(api, normalized);
        return normalized;
      })
      .catch((e: unknown) => {
        cache.delete(api);
        throw e;
      });
    cache.set(api, pending);
  }
  return pending;
}

const CONFIG_WHEN_UNAVAILABLE: ClientConfig = { ...DEFAULT_CLIENT_CONFIG, images: { ...DEFAULT_CLIENT_CONFIG.images, externalAllowed: false } };

export interface ClientConfigState {
  config: ClientConfig;
  /** 还没拿到服务端配置：此时 config 为默认值，外部示例图先不显示（避免在不允许外部图片的部署上闪现） */
  loading: boolean;
}

export function useClientConfig(): ClientConfigState {
  const api = getApiClient();
  const [state, setState] = useState<ClientConfigState>(() => {
    const known = resolved.get(api);
    return known ? { config: known, loading: false } : { config: DEFAULT_CLIENT_CONFIG, loading: true };
  });
  useEffect(() => {
    let active = true;
    const known = resolved.get(api);
    if (known) { setState({ config: known, loading: false }); return () => { active = false } }
    loadClientConfig(api)
      .then((config) => { if (active) setState({ config, loading: false }) })
      // 拿不到配置（网络错误、5xx）时按默认的数量与大小工作，但不提供外部示例图：
      // 宁可少一个选项，也不在禁止外部图片的部署上给出一定会被拒绝的选择（旧后端的 404 已在适配层换成默认值，不走这里）
      .catch(() => { if (active) setState({ config: CONFIG_WHEN_UNAVAILABLE, loading: false }) });
    return () => { active = false };
  }, [api]);
  return state;
}
