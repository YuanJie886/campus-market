import { CONTENT_BLOCKED_MESSAGE } from '../contracts';
import { ApiError } from '../errors';

/**
 * 离线演示的内容安全：后端 ContentSafetyService 关键词过滤的极简镜像（只放几条明确的违禁交易词，不复制完整词表）。
 * 比对方式与后端相同：NFKC 统一全半角、转小写、去掉空白 / 标点 / 符号，挡住「代 - 考」这类拆分。
 * 命中时给出与后端逐字相同的统一提示，不提示命中了哪个词。
 */
const MOCK_BLOCKED_WORDS = ['代考', '替考', '代写论文', '办证', '假证', '枪支', '管制刀具', '冰毒', '赌博', '刷单', '套现', '校园贷'];

export function normalizeForSafety(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function containsBlockedWord(...texts: Array<string | null | undefined>): boolean {
  const joined = normalizeForSafety(texts.filter((t): t is string => typeof t === 'string').join('\n'));
  return joined !== '' && MOCK_BLOCKED_WORDS.some((word) => joined.includes(normalizeForSafety(word)));
}

/** 与后端相同：拦截时 400 + 统一提示 */
export function requireSafeText(...texts: Array<string | null | undefined>): void {
  if (containsBlockedWord(...texts)) throw ApiError.mock({ code: 400, message: CONTENT_BLOCKED_MESSAGE });
}
