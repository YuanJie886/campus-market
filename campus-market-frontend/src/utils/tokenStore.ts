interface StoredToken { accessToken: string; expiresAtIso: string }
const KEY = 'campus_market_access_token_v1';
export class TokenStore {
  get(): StoredToken | null { try { const raw = window.localStorage.getItem(KEY); if (!raw) return null; const token = JSON.parse(raw) as StoredToken; if (!token.accessToken || (token.expiresAtIso && Date.parse(token.expiresAtIso) <= Date.now())) { this.clear(); return null } return token } catch { return null } }
  set(token: StoredToken): void { try { window.localStorage.setItem(KEY, JSON.stringify(token)) } catch { /* storage unavailable */ } }
  clear(): void { try { window.localStorage.removeItem(KEY) } catch { /* storage unavailable */ } }
  getAccessToken(): string | null { return this.get()?.accessToken ?? null }
}
export type { StoredToken };
