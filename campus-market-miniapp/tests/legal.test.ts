import { describe, expect, it, vi } from 'vitest';
import { AGREEMENT_REQUIRED_MESSAGE, registerAccount, registrationError, type RegistrationInput } from '../src/account';
import { LEGAL_DRAFT_NOTICE, OPERATOR, PRIVACY_PAGE, PRIVACY_POLICY, TERMS_PAGE, USER_AGREEMENT } from '../src/legal';
import type { User } from '../src/model';

const input: RegistrationInput = { account: ' student01 ', password: 'password123', nickname: ' 小明 ', campus: '东校区', contact: ' wx-123 ' };
const user: User = { id: 'u1', nickname: '小明', campus: '东校区' };

describe('注册必须先勾选同意《用户协议》《隐私政策》', () => {
  it('未勾选：给出提示，不调用注册接口', async () => {
    const register = vi.fn(async () => user);
    expect(registrationError(input, false)).toBe(AGREEMENT_REQUIRED_MESSAGE);
    await expect(registerAccount({ register }, input, false)).rejects.toThrow(AGREEMENT_REQUIRED_MESSAGE);
    expect(register).not.toHaveBeenCalled();
  });
  it('勾选后才注册；请求体只有后端白名单字段（不附带「已同意」字段），并去掉首尾空白', async () => {
    const register = vi.fn(async () => user);
    expect(registrationError(input, true)).toBeNull();
    await expect(registerAccount({ register }, input, true)).resolves.toEqual(user);
    expect(register).toHaveBeenCalledExactlyOnceWith({ account: 'student01', password: 'password123', nickname: '小明', campus: '东校区', contact: 'wx-123' });
  });
  it('资料不完整时先提示补全资料，同样不调用接口', async () => {
    const register = vi.fn(async () => user);
    await expect(registerAccount({ register }, { ...input, password: 'short' }, true)).rejects.toThrow('请填写账号、密码和注册资料');
    expect(register).not.toHaveBeenCalled();
  });
});

describe('用户协议与隐私政策（草案）', () => {
  const text = (doc: typeof PRIVACY_POLICY) => [doc.title, ...doc.meta, ...doc.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join('\n');
  it('两页顶部都标注「草案，待法务审核后生效」，运营主体是占位符而不是编造的公司', () => {
    for (const doc of [PRIVACY_POLICY, USER_AGREEMENT]) {
      expect(doc.draft).toBe(LEGAL_DRAFT_NOTICE);
      expect(LEGAL_DRAFT_NOTICE).toBe('草案，待法务审核后生效');
      expect(doc.meta[0]).toBe(`运营者：${OPERATOR}`);
      expect(text(doc)).not.toMatch(/有限公司|股份公司|工作室/);
    }
    expect(OPERATOR).toBe('【运营主体名称】');
  });
  it('隐私政策如实写明实际收集与共享的内容', () => {
    const policy = text(PRIVACY_POLICY);
    for (const fact of ['账号', '昵称', '所在校区', '联系方式', 'EXIF', '拍摄地点', '留言与私信', 'openid', '只有在你主动使用「微信一键登录」并把微信绑定到账号后',
      '不获取你的位置信息', '不提供支付功能', '卖家同意了该商品联系申请（且未撤回同意）', '公开展示联系方式', '治理案件、举报、处理与限制记录', '已注销用户', '微信内容安全接口']) {
      expect(policy).toContain(fact);
    }
  });
  it('页面路径与 app.config 注册的页面一致，且开启了 __usePrivacyCheck__', async () => {
    vi.stubGlobal('defineAppConfig', (config: unknown) => config);
    const { default: config } = await import('../src/app.config') as { default: { pages: string[]; __usePrivacyCheck__?: boolean } };
    expect(config.__usePrivacyCheck__).toBe(true);
    expect(config.pages).toContain(TERMS_PAGE.slice(1));
    expect(config.pages).toContain(PRIVACY_PAGE.slice(1));
    vi.unstubAllGlobals();
  });
});
