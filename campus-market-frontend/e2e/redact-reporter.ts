import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Playwright 在失败时自动写入的文本附件（error-context.md 等页面快照）同样脱敏：
 * JWT、刷新 Cookie、确认码数字、URL 片段里的邀请码以及任何 43 位 base64url 随机串（邀请码原文的形状）。
 * 截图与 trace 由 e2e/fixtures.ts 在生成时打码 / 脱敏。
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED-JWT]'],
  [/cm_refresh=[^;"\s]+/g, 'cm_refresh=[REDACTED]'],
  [/(交易确认码[：:]\s*)\d{6}/g, '$1[REDACTED]'],
  [/#(token|code|invite)=[^\s"')]+/g, '#$1=[REDACTED]'],
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, '[REDACTED-43]'],
];

export default class RedactReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult) {
    for (const a of result.attachments) {
      if (!a.path || !/\.(md|txt|log|json)$/.test(a.path) || !existsSync(a.path)) continue;
      let text = readFileSync(a.path, 'utf8');
      for (const [re, rep] of PATTERNS) text = text.replace(re, rep);
      writeFileSync(a.path, text);
    }
  }
}
