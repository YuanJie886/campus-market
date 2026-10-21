#!/usr/bin/env node
// 学校数据包工具（无第三方依赖，Node 18+）。说明见 docs/school-data.md。
//
// 生成：把楼栋 CSV + 学校信息（meta JSON）转换成数据包 JSON
//   node scripts/school-pack-from-csv.mjs --meta school-meta.json --csv buildings.csv --out src/main/resources/schools/<id>.json
//   （不给 --csv 时生成没有楼栋的数据包；不给 --out 时输出到标准输出）
//
// 校验：检查一个或多个现成的数据包（多个文件时还检查 id 是否跨文件重复）
//   node scripts/school-pack-from-csv.mjs --validate src/main/resources/schools/*.json
//
// 规则与后端 SchoolPackValidator 一致；发现问题时逐条打印（CSV 问题带行号）并以退出码 1 结束。
// 与数据库现有数据的冲突（例如 id 已被别的学校占用）只能在后端启动导入时发现。

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const COORDINATE_SYSTEMS = ['GCJ-02', 'WGS-84', 'BD-09'];
export const MAX_NAME_LENGTH = 40;
export const MAX_BUILDINGS = 3000;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_SORT_ORDER = 1_000_000;
export const LAT_RANGE = [3, 54];
export const LNG_RANGE = [73, 136];
export const CSV_COLUMNS = ['campus_id', 'zone', 'building_id', 'building_name', 'latitude', 'longitude', 'sort_order'];
const SCHOOL_FIELDS = ['id', 'name', 'shortName', 'coordinateSystem', 'active', 'sortOrder', 'notes', 'campuses'];
const CAMPUS_FIELDS = ['id', 'name', 'sortOrder', 'buildings'];
const BUILDING_FIELDS = ['id', 'zone', 'name', 'latitude', 'longitude', 'sortOrder'];
const RESERVED_SCHOOL_ID = 'pilot';
const EXAMPLE_MARK = '示例';

const length = (s) => [...s].length;

/**
 * 解析 UTF-8 CSV（RFC 4180：逗号分隔，双引号包裹的字段里可以有逗号、换行，"" 表示一个双引号）。
 * 返回 [{line, fields}]，line 是该记录开始的物理行号（表头为第 1 行）；空行跳过。
 */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = [];
  let fields = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let touched = false;
  const endRecord = () => {
    fields.push(field);
    if (touched || fields.length > 1 || fields[0] !== '') records.push({ line: start, fields });
    fields = [];
    field = '';
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; touched = true; continue; }
    if (ch === ',') { fields.push(field); field = ''; touched = true; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { endRecord(); line++; start = line; continue; }
    field += ch;
  }
  if (quoted) throw new Error(`第 ${start} 行：引号没有闭合`);
  if (field !== '' || fields.length > 0 || touched) endRecord();
  return records;
}

function checkName(value, where, problems, required = true) {
  if (value === undefined || value === null) {
    if (required) problems.push(`${where}：必填`);
    return undefined;
  }
  if (typeof value !== 'string') { problems.push(`${where}：必须是字符串`); return undefined; }
  const v = value.trim();
  if (!v) { problems.push(`${where}：不能为空白`); return undefined; }
  if (length(v) > MAX_NAME_LENGTH) { problems.push(`${where}：'${v}' 超过 ${MAX_NAME_LENGTH} 个字符`); return undefined; }
  return v;
}

function checkId(value, where, problems) {
  if (value === undefined || value === null) { problems.push(`${where}：必填`); return undefined; }
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    problems.push(`${where}：'${value}' 不符合 id 规则：小写字母、数字、连字符，以字母或数字开头，2～63 个字符`);
    return undefined;
  }
  return value;
}

function checkSortOrder(value, where, problems) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0 || value > MAX_SORT_ORDER) {
    problems.push(`${where}：必须是 0～${MAX_SORT_ORDER} 的整数`);
    return 0;
  }
  return value;
}

function checkCoordinate(value, where, [min, max], label, problems) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) { problems.push(`${where}：${label}必须是数字`); return undefined; }
  if (value < min || value > max) {
    problems.push(`${where}：${label} ${value} 不在中国范围内（${label} ${min}～${max}）`);
    return undefined;
  }
  return value;
}

function onlyFields(obj, allowed, prefix, problems) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) problems.push(`${prefix}${key}：不支持的字段（允许的字段：${[...allowed].sort().join('、')}）`);
  }
}

/**
 * 按后端规则校验一个数据包对象，返回问题列表（空数组表示通过）。
 * locate(campusIndex, buildingIndex, field) 可以把 JSON 路径换成 CSV 行号等更好找的位置。
 */
export function validatePack(pack, { expectedId, locate } = {}) {
  const problems = [];
  const at = locate ?? ((c, b, f) => `campuses[${c}].buildings[${b}].${f}`);
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return ['顶层必须是 JSON 对象'];
  onlyFields(pack, SCHOOL_FIELDS, '', problems);
  const id = checkId(pack.id, 'id', problems);
  if (id === RESERVED_SCHOOL_ID) problems.push(`id：'pilot' 是内置演示学校，不能作为数据包 id`);
  if (id && expectedId && id !== expectedId) problems.push(`id：与文件名中的 '${expectedId}' 不一致（实际为 '${id}'）`);
  checkName(pack.name, 'name', problems);
  checkName(pack.shortName, 'shortName', problems, false);
  if (pack.coordinateSystem === undefined || pack.coordinateSystem === null) problems.push('coordinateSystem：必填');
  else if (!COORDINATE_SYSTEMS.includes(pack.coordinateSystem)) {
    problems.push(`coordinateSystem：必须是 GCJ-02、WGS-84 或 BD-09 之一（实际为 '${pack.coordinateSystem}'）；同一学校只能使用一种坐标系`);
  }
  if (pack.active !== undefined && pack.active !== null && typeof pack.active !== 'boolean') problems.push('active：必须是 true 或 false');
  checkSortOrder(pack.sortOrder, 'sortOrder', problems);
  if (pack.notes !== undefined && pack.notes !== null) {
    if (typeof pack.notes !== 'string') problems.push('notes：必须是字符串');
    else if (length(pack.notes) > MAX_NOTES_LENGTH) problems.push(`notes：不能超过 ${MAX_NOTES_LENGTH} 个字符`);
  }
  if (!Array.isArray(pack.campuses) || pack.campuses.length === 0) {
    problems.push('campuses：必须是至少包含一个校区的数组');
    return problems;
  }
  const campusIds = new Map();
  const campusNames = new Map();
  const buildingIds = new Map();
  let total = 0;
  pack.campuses.forEach((campus, ci) => {
    const cpath = `campuses[${ci}]`;
    if (!campus || typeof campus !== 'object' || Array.isArray(campus)) { problems.push(`${cpath}：必须是对象`); return; }
    onlyFields(campus, CAMPUS_FIELDS, `${cpath}.`, problems);
    const cid = checkId(campus.id, `${cpath}.id`, problems);
    if (cid) {
      if (campusIds.has(cid)) problems.push(`${cpath}.id：校区 id '${cid}' 与 ${campusIds.get(cid)} 重复`);
      else campusIds.set(cid, cpath);
    }
    const cname = checkName(campus.name, `${cpath}.name`, problems);
    if (cname) {
      if (campusNames.has(cname)) problems.push(`${cpath}.name：校区名 '${cname}' 与 ${campusNames.get(cname)} 重复`);
      else campusNames.set(cname, cpath);
    }
    checkSortOrder(campus.sortOrder, `${cpath}.sortOrder`, problems);
    if (!Array.isArray(campus.buildings)) { problems.push(`${cpath}.buildings：必须是数组（还没有楼栋数据时写 []）`); return; }
    total += campus.buildings.length;
    const names = new Map();
    campus.buildings.forEach((b, bi) => {
      const where = (f) => at(ci, bi, f);
      if (!b || typeof b !== 'object' || Array.isArray(b)) { problems.push(`${where('')}：必须是对象`); return; }
      for (const key of Object.keys(b)) {
        if (!BUILDING_FIELDS.includes(key)) problems.push(`${where(key)}：不支持的字段（允许的字段：${[...BUILDING_FIELDS].sort().join('、')}）`);
      }
      const bid = checkId(b.id, where('id'), problems);
      if (bid) {
        if (buildingIds.has(bid)) problems.push(`${where('id')}：楼栋 id '${bid}' 与 ${buildingIds.get(bid)} 重复`);
        else buildingIds.set(bid, where('id'));
      }
      checkName(b.zone, where('zone'), problems);
      const bname = checkName(b.name, where('name'), problems);
      if (bname) {
        if (names.has(bname)) problems.push(`${where('name')}：同一校区内楼栋名 '${bname}' 与 ${names.get(bname)} 重复`);
        else names.set(bname, where('name'));
      }
      const hasLat = b.latitude !== undefined && b.latitude !== null;
      const hasLng = b.longitude !== undefined && b.longitude !== null;
      checkCoordinate(b.latitude, where('latitude'), LAT_RANGE, '纬度', problems);
      checkCoordinate(b.longitude, where('longitude'), LNG_RANGE, '经度', problems);
      if (hasLat !== hasLng) problems.push(`${where(hasLat ? 'longitude' : 'latitude')}：经纬度必须同时填写或同时留空`);
      checkSortOrder(b.sortOrder, where('sortOrder'), problems);
    });
  });
  if (total > MAX_BUILDINGS) problems.push(`campuses：楼栋总数 ${total} 超过 ${MAX_BUILDINGS} 栋`);
  return problems;
}

/** 多个数据包同时启用：学校 id、校区 id、楼栋 id 全局唯一。packs: [{source, pack}] */
export function validateTogether(packs) {
  const problems = [];
  const seen = { school: new Map(), campus: new Map(), building: new Map() };
  const claim = (kind, label, id, source) => {
    if (!id) return;
    if (seen[kind].has(id) && seen[kind].get(id) !== source) problems.push(`${source}：${label} '${id}' 已在 ${seen[kind].get(id)} 中使用`);
    else seen[kind].set(id, source);
  };
  for (const { source, pack } of packs) {
    if (seen.school.has(pack?.id)) { problems.push(`${source}：学校 id '${pack.id}' 与 ${seen.school.get(pack.id)} 重复`); continue; }
    claim('school', '学校 id', pack?.id, source);
    for (const c of pack?.campuses ?? []) {
      claim('campus', '校区 id', c?.id, source);
      for (const b of c?.buildings ?? []) claim('building', '楼栋 id', b?.id, source);
    }
  }
  return problems;
}

const csvNumber = (raw) => {
  const v = raw.trim();
  if (v === '') return undefined;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(v)) return NaN;
  return Number(v);
};

/**
 * CSV + 学校信息 → 数据包。返回 {pack, problems}；problems 里的 CSV 问题都带行号。
 * meta 的格式与数据包相同（可以直接拿现有数据包当 meta），其中各校区的 buildings 会被 CSV 的内容替换。
 */
export function buildPack(meta, csvText, { csvName = 'buildings.csv' } = {}) {
  const problems = [];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { pack: null, problems: ['meta：顶层必须是 JSON 对象'] };
  const fromCsv = csvText !== undefined && csvText !== null;
  // 给了 CSV 时楼栋全部来自 CSV（meta 里原有的 buildings 被替换）；没给 CSV 时保留 meta 里的 buildings（缺省为 []）
  const pack = { ...meta };
  if (Array.isArray(meta.campuses)) {
    pack.campuses = meta.campuses.map((c) => (c && typeof c === 'object' && !Array.isArray(c)
      ? { ...c, buildings: fromCsv ? [] : (c.buildings ?? []) } : c));
  }
  const where = new Map(); // "ci/bi" → CSV 行号
  if (fromCsv) {
    let records;
    try {
      records = parseCsv(csvText);
    } catch (e) {
      return { pack: null, problems: [`${csvName} ${e.message}`] };
    }
    if (records.length === 0) return { pack: null, problems: [`${csvName}：文件为空，至少需要表头 ${CSV_COLUMNS.join(',')}`] };
    const header = records[0].fields.map((h) => h.trim());
    const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
    const extra = header.filter((h) => !CSV_COLUMNS.includes(h));
    if (missing.length || extra.length || header.length !== CSV_COLUMNS.length) {
      return { pack: null, problems: [`${csvName} 第 1 行（表头）：必须正好是 ${CSV_COLUMNS.join(',')}` +
        (missing.length ? `；缺少 ${missing.join('、')}` : '') + (extra.length ? `；多出 ${extra.join('、')}` : '')] };
    }
    const col = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)]));
    const campusIndex = new Map((Array.isArray(pack.campuses) ? pack.campuses : []).map((c, i) => [c?.id, i]));
    for (const { line, fields } of records.slice(1)) {
      const loc = `${csvName} 第 ${line} 行`;
      if (fields.length !== CSV_COLUMNS.length) {
        problems.push(`${loc}：应有 ${CSV_COLUMNS.length} 列，实际 ${fields.length} 列（字段里有逗号时请用双引号包起来）`);
        continue;
      }
      const get = (c) => fields[col[c]];
      if ([get('zone'), get('building_name'), get('building_id'), get('campus_id')].some((v) => v.includes(EXAMPLE_MARK))) {
        problems.push(`${loc}：这是模板里的示例行（含「${EXAMPLE_MARK}」），请删除后再转换`);
        continue;
      }
      const campusId = get('campus_id').trim();
      if (!campusIndex.has(campusId)) {
        problems.push(`${loc}：campus_id '${campusId}' 不在学校信息的 campuses 里（可选：${[...campusIndex.keys()].join('、')}）`);
        continue;
      }
      const ci = campusIndex.get(campusId);
      const latitude = csvNumber(get('latitude'));
      const longitude = csvNumber(get('longitude'));
      const sortRaw = get('sort_order').trim();
      let sortOrder;
      if (sortRaw !== '') {
        sortOrder = /^\d+$/.test(sortRaw) ? Number(sortRaw) : NaN;
        if (Number.isNaN(sortOrder)) { problems.push(`${loc}：sort_order '${sortRaw}' 必须是非负整数`); continue; }
      }
      if (Number.isNaN(latitude)) { problems.push(`${loc}：latitude '${get('latitude').trim()}' 不是数字`); continue; }
      if (Number.isNaN(longitude)) { problems.push(`${loc}：longitude '${get('longitude').trim()}' 不是数字`); continue; }
      const building = { id: get('building_id').trim(), zone: get('zone').trim(), name: get('building_name').trim() };
      if (latitude !== undefined) building.latitude = latitude;
      if (longitude !== undefined) building.longitude = longitude;
      if (sortOrder !== undefined) building.sortOrder = sortOrder;
      const bi = pack.campuses[ci].buildings.push(building) - 1;
      where.set(`${ci}/${bi}`, line);
    }
  }
  const csvField = { id: 'building_id', zone: 'zone', name: 'building_name', latitude: 'latitude', longitude: 'longitude', sortOrder: 'sort_order' };
  // 楼栋问题定位到 CSV 行号；其余问题（学校、校区）定位到 meta 的字段
  const locate = (ci, bi, f) => {
    const line = where.get(`${ci}/${bi}`);
    return line ? `${csvName} 第 ${line} 行 ${csvField[f] ?? f}` : `campuses[${ci}].buildings[${bi}].${f}`;
  };
  problems.push(...validatePack(pack, { locate }).map((p) => (p.startsWith(csvName) ? p : `meta.${p}`)));
  return { pack, problems };
}

/** 稳定的输出格式：两空格缩进、末尾换行。 */
export function formatPack(pack) {
  return JSON.stringify(pack, null, 2) + '\n';
}

function parseArgs(argv) {
  const args = { validate: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--meta' || a === '--csv' || a === '--out') args[a.slice(2)] = argv[++i];
    else if (a === '--validate') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.validate.push(argv[++i]); }
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`不认识的参数：${a}`);
  }
  return args;
}

const USAGE = `用法：
  node scripts/school-pack-from-csv.mjs --meta <学校信息.json> [--csv <楼栋.csv>] [--out <输出.json>]
  node scripts/school-pack-from-csv.mjs --validate <数据包.json> [更多数据包.json ...]`;

export function main(argv, { log = console.log, error = console.error, write = (p, s) => writeFileSync(p, s) } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (e) { error(e.message); error(USAGE); return 2; }
  if (args.help || (!args.meta && args.validate.length === 0)) { (args.help ? log : error)(USAGE); return args.help ? 0 : 2; }
  const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (args.validate.length) {
    const problems = [];
    const loaded = [];
    for (const file of args.validate) {
      let pack;
      try { pack = readJson(file); } catch (e) { problems.push(`${file}：不是合法的 JSON 或无法读取（${e.message}）`); continue; }
      const expectedId = basename(file).replace(/\.json$/, '');
      problems.push(...validatePack(pack, { expectedId }).map((p) => `${file}：${p}`));
      loaded.push({ source: file, pack });
    }
    problems.push(...validateTogether(loaded));
    if (problems.length) { problems.forEach((p) => error(p)); error(`共 ${problems.length} 个问题`); return 1; }
    log(`通过：${args.validate.length} 个数据包`);
    return 0;
  }
  let meta;
  try { meta = readJson(args.meta); } catch (e) { error(`${args.meta}：不是合法的 JSON 或无法读取（${e.message}）`); return 1; }
  let csvText;
  if (args.csv) {
    try { csvText = readFileSync(args.csv, 'utf8'); } catch (e) { error(`${args.csv}：无法读取（${e.message}）`); return 1; }
  }
  const { pack, problems } = buildPack(meta, csvText, { csvName: args.csv ? basename(args.csv) : 'buildings.csv' });
  if (problems.length) { problems.forEach((p) => error(p)); error(`共 ${problems.length} 个问题，未生成数据包`); return 1; }
  const text = formatPack(pack);
  if (args.out) {
    write(args.out, text);
    const count = pack.campuses.reduce((n, c) => n + c.buildings.length, 0);
    log(`已生成 ${args.out}：${pack.campuses.length} 个校区、${count} 栋楼`);
  } else log(text.trimEnd());
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
