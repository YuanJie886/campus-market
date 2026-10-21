import { INVITE_CODE_INVALID, INVITE_CODE_PATTERN, INVITE_CODE_REQUIRED, formatInviteCodeInput, normalizeInviteCode } from '../contracts';
import { ApiError } from '../errors';

/**
 * 离线演示的注册邀请码（只在 Mock 构建里出现，REST 构建里随 MockCampusMarketApi 一起被摇掉，
 * check-bundles 以「CAMP-US23-4567」与「mock_invite_required_v1」标记验证）。
 *
 * <p>真实部署的邀请码由学校工作人员在管理后台发放；这里只是一份写死的演示清单，
 * 使用次数只记在内存里（刷新页面即恢复），注册页的「演示邀请码」面板会列出它们。
 */
export interface MockInviteCodeSeed { code: string; maxUses: number }
export const MOCK_DEMO_INVITE_CODES: readonly MockInviteCodeSeed[] = /* @__PURE__ */ Object.freeze([
  { code: 'CAMP-US23-4567', maxUses: 100 },
  // 只能用一次：用来体验「邀请码无效或已用完」
  { code: 'XYZW-2345-6789', maxUses: 1 },
]);

/** 是否以邀请制运行离线演示（localStorage 的 campus_market_mock_invite_required_v1；默认 false，与后端默认相同） */
export const MOCK_INVITE_REQUIRED_KEY = 'mock_invite_required_v1';

export interface MockInviteCodeStatus { code: string; maxUses: number; remaining: number }

/** 与后端相同的校验与提示；校验与计数在同一个同步步骤里完成，不会出现两次注册同时用掉最后一次的情况 */
export class MockInviteCodeBook {
  private readonly entries = new Map<string, { code: string; maxUses: number; used: number }>();

  constructor(seeds: readonly MockInviteCodeSeed[]) {
    for (const seed of seeds) {
      const display = formatInviteCodeInput(seed.code);
      if (!INVITE_CODE_PATTERN.test(display) || !Number.isInteger(seed.maxUses) || seed.maxUses < 1) throw new Error(`演示邀请码格式无效：${seed.code}`);
      this.entries.set(normalizeInviteCode(seed.code), { code: display, maxUses: seed.maxUses, used: 0 });
    }
  }

  /** 与后端注册的第一步相同：缺失 / 空白 → 400「请输入邀请码」；不是字符串 → 400「邀请码无效或已用完」 */
  requirePresent(raw: unknown): void {
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) throw ApiError.mock({ code: 400, message: INVITE_CODE_REQUIRED, httpStatus: 400 });
    if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: INVITE_CODE_INVALID, httpStatus: 400 });
  }

  /** 存在且还有次数；否则 400「邀请码无效或已用完」（不区分是哪一种）。不计数。 */
  check(raw: unknown): string {
    this.requirePresent(raw);
    const key = normalizeInviteCode(raw as string);
    const entry = this.entries.get(key);
    if (!entry || entry.used >= entry.maxUses) throw ApiError.mock({ code: 400, message: INVITE_CODE_INVALID, httpStatus: 400 });
    return key;
  }

  /** 再校验一次并计一次使用：调用方必须在创建账号的同一个同步步骤里调用（中间没有 await） */
  consume(raw: unknown): void {
    const key = this.check(raw);
    this.entries.get(key)!.used += 1;
  }

  list(): MockInviteCodeStatus[] {
    return [...this.entries.values()].map((e) => ({ code: e.code, maxUses: e.maxUses, remaining: e.maxUses - e.used }));
  }
}
