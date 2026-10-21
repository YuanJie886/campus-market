import { describe, expect, it, vi } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { keepBuilding, profileError, profileInput, zonesOf, type ProfileForm } from '../src/profile';
import { AVATAR_PRESETS } from '../src/avatar';
import { CIRCLE_PAGES, DEMAND_PAGES, MORE_ENTRIES, PAGES, SUB_PACKAGES, SUPPLY_PAGES, TEXTBOOK_PAGES } from '../src/menu';

const form: ProfileForm = { nickname: ' 小明 ', campus: '东校区', contact: '', avatar: '', dormBuildingId: null };
function setup() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return new MockApi(storage);
}

describe('编辑资料规则（与 Web 个人资料一致）', () => {
  it('昵称 1–16 字；修改后的联系方式须为手机号或学号；未修改的旧联系方式不挡保存', () => {
    expect(profileError({ ...form, nickname: ' ' })).toBe('昵称不能为空');
    expect(profileError({ ...form, nickname: '一二三四五六七八九十一二三四五六七' })).toBe('昵称最多 16 个字');
    expect(profileError({ ...form, contact: 'wechat:abc' }, { contact: '' })).toBe('联系方式需为有效手机号或学号');
    expect(profileError({ ...form, contact: '13800000000' })).toBeNull();
    expect(profileError({ ...form, contact: 'student01' })).toBeNull();
    expect(profileError({ ...form, contact: 'wechat:abc' }, { contact: 'wechat:abc' })).toBeNull();
  });
  // REWRITTEN：头像只在改动过时发送（"" = 不使用头像），预设值改为 preset:N
  it('请求体：联系方式留空用账号，头像没改不发送、改成预设 / 不使用头像时发送，宿舍楼不填显式传 null', () => {
    expect(profileInput(form, { account: 'buyer001' })).toEqual({ nickname: '小明', campus: '东校区', contact: 'buyer001', dormBuildingId: null });
    expect(profileInput({ ...form, avatar: AVATAR_PRESETS[2], dormBuildingId: 'b1', contact: ' 13800000000 ' }, { account: 'x' }))
      .toEqual({ nickname: '小明', campus: '东校区', contact: '13800000000', avatar: 'preset:3', dormBuildingId: 'b1' });
    expect(profileInput({ ...form, avatar: '' }, { account: 'x' }, 'preset:5')).toMatchObject({ avatar: '' });
  });
  it('校区变化后清掉不属于新校区的宿舍楼', () => {
    const list = [{ id: 'a', campusId: '东校区' as const, zone: '沁园', name: '1号楼' }, { id: 'b', campusId: '东校区' as const, zone: '澜园', name: '5号楼' }, { id: 'c', campusId: '东校区' as const, zone: '沁园', name: '2号楼' }];
    expect(zonesOf(list)).toEqual(['沁园', '澜园']);
    expect(keepBuilding(list, 'b')).toBe('b');
    expect(keepBuilding(list, 'other')).toBeNull();
  });
});

describe('演示模式资料', () => {
  // REWRITTEN：预设头像改为 preset:N
  it('保存头像与宿舍楼；宿舍楼只在本人资料里，公共资料没有；校区不匹配的楼栋 400；昵称内容安全 400', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const [building] = await api.buildings('东校区');
    const saved = await api.updateProfile({ nickname: '小鹿', campus: '东校区', contact: '13800000000', avatar: AVATAR_PRESETS[1], dormBuildingId: building.id });
    expect(saved).toMatchObject({ nickname: '小鹿', avatar: 'preset:2', dormBuildingId: building.id, contact: '13800000000' });
    expect(await api.me()).toMatchObject({ dormBuildingId: building.id });
    await expect(api.updateProfile({ nickname: '小鹿', campus: '东校区', contact: '', dormBuildingId: (await api.buildings('西校区'))[0].id })).rejects.toMatchObject({ code: 400 });
    await expect(api.updateProfile({ nickname: '办证小鹿', campus: '东校区', contact: '' })).rejects.toMatchObject({ code: 400, message: '内容可能包含违规信息，请修改后再提交' });
    expect((await api.updateProfile({ nickname: '小鹿', campus: '东校区', contact: '13800000000', dormBuildingId: null })).dormBuildingId).toBeNull();
    await api.login('seller001', 'demo12345');
    const pub = await api.publicUser('demo-buyer');
    expect(pub).toMatchObject({ nickname: '小鹿', avatar: 'preset:2' });
    expect(pub).not.toHaveProperty('dormBuildingId');
    expect(pub).not.toHaveProperty('contact');
  });
});

describe('导航：新页面都已注册，「更多」可以追加', () => {
  // REWRITTEN：第二部分的页面注册在分包里；「更多」加入了需求匹配、圈子、批量发布、协助整理、课程教材与教材建议
  it('主包页面、分包页面与「更多」入口都在 app.config 里', async () => {
    vi.stubGlobal('defineAppConfig', (config: unknown) => config);
    const { default: config } = await import('../src/app.config') as { default: { pages: string[]; subPackages: { root: string; pages: string[] }[] } };
    const registered = [...config.pages, ...config.subPackages.flatMap((p) => p.pages.map((page) => `${p.root}/${page}`))];
    for (const url of [...Object.values(PAGES), ...Object.values(SUPPLY_PAGES), ...Object.values(CIRCLE_PAGES), ...Object.values(DEMAND_PAGES), ...Object.values(TEXTBOOK_PAGES), ...MORE_ENTRIES.map((e) => e.url)]) {
      expect(registered).toContain(url.slice(1));
    }
    expect(config.subPackages).toEqual(SUB_PACKAGES);
    // 新功能都在分包里，不占主包
    for (const url of [...Object.values(SUPPLY_PAGES), ...Object.values(CIRCLE_PAGES), ...Object.values(DEMAND_PAGES), ...Object.values(TEXTBOOK_PAGES)]) expect(config.pages).not.toContain(url.slice(1));
    expect(MORE_ENTRIES.map((e) => e.label)).toEqual(['需求匹配', '我的圈子', '毕业季快速发布', '协助整理发布', '课程教材', '我的教材建议', '我的举报', '我的限制与申诉']);
    vi.unstubAllGlobals();
  });
});
