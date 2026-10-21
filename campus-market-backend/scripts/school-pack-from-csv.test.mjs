// node --test scripts/school-pack-from-csv.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, buildPack, validatePack, validateTogether, formatPack, main } from './school-pack-from-csv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AUST = join(here, '..', 'src', 'main', 'resources', 'schools', 'aust.json');
const TEMPLATES = join(here, '..', '..', 'docs', 'school-data');
const HEADER = 'campus_id,zone,building_id,building_name,latitude,longitude,sort_order';

const meta = () => ({
  id: 'demo-u', name: '示例大学', shortName: '示例', coordinateSystem: 'GCJ-02',
  campuses: [{ id: 'demo-u-a', name: '甲校区', sortOrder: 1 }, { id: 'demo-u-b', name: '乙校区', sortOrder: 2 }],
});
const csv = (...rows) => [HEADER, ...rows].join('\n') + '\n';
const problemsOf = (...rows) => buildPack(meta(), csv(...rows)).problems;
const capture = () => {
  const out = { log: [], error: [], files: {} };
  return { out, io: { log: (s) => out.log.push(s), error: (s) => out.error.push(s), write: (p, s) => { out.files[p] = s; } } };
};

test('parseCsv：BOM、CRLF、引号里的逗号 / 双引号 / 换行、空行，行号是记录开始的物理行', () => {
  const text = '﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\n"multi\nline",z\n';
  assert.deepEqual(parseCsv(text), [
    { line: 1, fields: ['a', 'b'] },
    { line: 2, fields: ['x, y', 'he said "hi"'] },
    { line: 4, fields: ['multi\nline', 'z'] },
  ]);
  assert.throws(() => parseCsv('a,"b\n'), /引号没有闭合/);
});

test('转换：坐标转成数字、空坐标省略、sort_order 缺省为 0（省略），没有楼栋的校区保留空数组', () => {
  const { pack, problems } = buildPack(meta(), csv(
    'demo-u-a,北区,demo-u-a-1,1号楼,32.632145,116.983210,1',
    'demo-u-a,北区,demo-u-a-2,"2号楼, 东侧",,,',
  ));
  assert.deepEqual(problems, []);
  assert.deepEqual(pack.campuses[0].buildings, [
    { id: 'demo-u-a-1', zone: '北区', name: '1号楼', latitude: 32.632145, longitude: 116.98321, sortOrder: 1 },
    { id: 'demo-u-a-2', zone: '北区', name: '2号楼, 东侧' },
  ]);
  assert.deepEqual(pack.campuses[1].buildings, []);
  assert.equal(pack.coordinateSystem, 'GCJ-02');
  assert.ok(formatPack(pack).endsWith('}\n'));
});

test('经纬度：只填一个、超出中国范围、不是数字，都报出 CSV 行号', () => {
  const problems = problemsOf(
    'demo-u-a,北区,demo-u-a-1,1号楼,32.6,,1',
    'demo-u-a,北区,demo-u-a-2,2号楼,60.1,116.9,2',
    'demo-u-a,北区,demo-u-a-3,3号楼,32.6,140,3',
    'demo-u-a,北区,demo-u-a-4,4号楼,32.6N,116.9,4',
  );
  assert.ok(problems.some((p) => p.includes('第 2 行') && p.includes('同时填写或同时留空')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('第 3 行 latitude') && p.includes('纬度 3～54')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('第 4 行 longitude') && p.includes('经度 73～136')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('第 5 行') && p.includes("latitude '32.6N' 不是数字")), problems.join('\n'));
});

test('id 规则、重复 id、同校区重名、未知校区、列数不对、sort_order 非法，都带行号', () => {
  const problems = problemsOf(
    'demo-u-a,北区,Bad_ID,1号楼,,,1',
    'demo-u-a,北区,demo-u-a-2,2号楼,,,2',
    'demo-u-a,北区,demo-u-a-2,3号楼,,,3',
    'demo-u-a,北区,demo-u-a-4,2号楼,,,4',
    'demo-u-x,北区,demo-u-x-1,1号楼,,,1',
    'demo-u-a,北区,demo-u-a-6,6号楼,,',
    'demo-u-a,北区,demo-u-a-7,7号楼,,,-1',
    'demo-u-b,北区,demo-u-b-1,2号楼,,,1',
  );
  const has = (line, text) => assert.ok(problems.some((p) => p.includes(`第 ${line} 行`) && p.includes(text)), `${line} ${text}\n${problems.join('\n')}`);
  has(2, '不符合 id 规则');
  has(4, "楼栋 id 'demo-u-a-2' 与 buildings.csv 第 3 行 building_id 重复");
  has(5, "同一校区内楼栋名 '2号楼'");
  has(6, "campus_id 'demo-u-x' 不在学校信息的 campuses 里");
  has(7, '应有 7 列，实际 6 列');
  has(8, "sort_order '-1' 必须是非负整数");
  assert.ok(!problems.some((p) => p.includes('第 9 行')), '不同校区可以同名');
});

test('名称：空白与超过 40 个字符都拒绝（园区、楼栋名、学校信息里的名称）', () => {
  const long = '长'.repeat(41);
  const problems = problemsOf(`demo-u-a, ,demo-u-a-1,1号楼,,,1`, `demo-u-a,北区,demo-u-a-2,${long},,,2`);
  assert.ok(problems.some((p) => p.includes('第 2 行 zone') && p.includes('不能为空白')));
  assert.ok(problems.some((p) => p.includes('第 3 行 building_name') && p.includes('超过 40 个字符')));
  const m = meta();
  m.campuses[0].name = long;
  m.shortName = ' ';
  const metaProblems = buildPack(m, csv()).problems;
  assert.ok(metaProblems.some((p) => p.startsWith('meta.campuses[0].name') && p.includes('超过 40')), metaProblems.join('\n'));
  assert.ok(metaProblems.some((p) => p.startsWith('meta.shortName') && p.includes('不能为空白')), metaProblems.join('\n'));
});

test('学校信息：pilot 保留、坐标系只能三选一、不认识的字段、校区 id 重复都拒绝', () => {
  const m = meta();
  m.id = 'pilot';
  m.coordinateSystem = 'gcj02';
  m.website = 'x';
  m.campuses[1].id = 'demo-u-a';
  const problems = buildPack(m, csv()).problems;
  for (const text of ["'pilot' 是内置演示学校", 'GCJ-02、WGS-84 或 BD-09', 'website：不支持的字段', "校区 id 'demo-u-a' 与 campuses[0] 重复"]) {
    assert.ok(problems.some((p) => p.includes(text)), `${text}\n${problems.join('\n')}`);
  }
  assert.deepEqual(validatePack({ ...meta(), campuses: [] }), ['campuses：必须是至少包含一个校区的数组']);
});

test('楼栋总数上限 3000', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => `demo-u-a,北区,demo-u-a-${i},${i}号楼,,,`);
  assert.deepEqual(problemsOf(...rows(3000)), []);
  assert.ok(problemsOf(...rows(3001)).some((p) => p.includes('超过 3000')));
});

test('模板：示例行会被拒绝（防止把示例数据当真实数据导入），表头不对时直接报错', () => {
  const template = readFileSync(join(TEMPLATES, 'buildings-template.csv'), 'utf8');
  assert.equal(template.split('\n')[0], HEADER);
  const metaTemplate = JSON.parse(readFileSync(join(TEMPLATES, 'school-meta-template.json'), 'utf8'));
  const { problems } = buildPack(metaTemplate, template);
  assert.equal(problems.filter((p) => p.includes('示例行')).length, 2, problems.join('\n'));
  assert.deepEqual(buildPack(metaTemplate, undefined).problems, [], '没有 CSV 时学校信息模板本身合法');
  assert.match(buildPack(meta(), 'campus,zone\n').problems[0], /第 1 行（表头）.*缺少/);
});

test('多个数据包：校区 id、楼栋 id 不能跨文件重复', () => {
  const a = buildPack(meta(), csv('demo-u-a,北区,shared-1,1号楼,,,1')).pack;
  const b = { ...a, id: 'other-u', campuses: [{ id: 'demo-u-a', name: '甲', buildings: [{ id: 'shared-1', zone: '区', name: '楼' }] }] };
  const problems = validateTogether([{ source: 'demo-u.json', pack: a }, { source: 'other-u.json', pack: b }]);
  assert.ok(problems.some((p) => p.includes("校区 id 'demo-u-a' 已在 demo-u.json 中使用")));
  assert.ok(problems.some((p) => p.includes("楼栋 id 'shared-1' 已在 demo-u.json 中使用")));
});

test('命令行：--validate 内置的 aust.json 通过；--meta/--csv/--out 生成文件；有问题时退出码 1 并逐条打印', () => {
  let { out, io } = capture();
  assert.equal(main(['--validate', AUST], io), 0, out.error.join('\n'));
  assert.match(out.log[0], /通过：1 个数据包/);

  const dir = mkdtempSync(join(tmpdir(), 'school-pack-'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta()));
  writeFileSync(join(dir, 'b.csv'), csv('demo-u-a,北区,demo-u-a-1,1号楼,32.6,116.9,1'));
  ({ out, io } = capture());
  const target = join(dir, 'demo-u.json');
  assert.equal(main(['--meta', join(dir, 'meta.json'), '--csv', join(dir, 'b.csv'), '--out', target], io), 0, out.error.join('\n'));
  const written = JSON.parse(out.files[target]);
  assert.equal(written.campuses[0].buildings[0].latitude, 32.6);
  writeFileSync(target, out.files[target]);
  ({ out, io } = capture());
  assert.equal(main(['--validate', target, AUST], io), 0, out.error.join('\n'));

  writeFileSync(join(dir, 'bad.csv'), csv('demo-u-a,北区,demo-u-a-1,1号楼,32.6,,1'));
  ({ out, io } = capture());
  assert.equal(main(['--meta', join(dir, 'meta.json'), '--csv', join(dir, 'bad.csv')], io), 1);
  assert.ok(out.error.some((l) => l.includes('bad.csv 第 2 行')), out.error.join('\n'));
  assert.ok(out.error.at(-1).includes('未生成数据包'));

  writeFileSync(join(dir, 'wrong-name.json'), out.files[target] ?? readFileSync(target, 'utf8'));
  ({ out, io } = capture());
  assert.equal(main(['--validate', join(dir, 'wrong-name.json')], io), 1);
  assert.ok(out.error.some((l) => l.includes('与文件名中的')));
});
