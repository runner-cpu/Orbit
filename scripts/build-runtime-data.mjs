#!/usr/bin/env node
/**
 * 生成作品运行时使用的数据包。
 *
 * 设计背景：
 *   第一章需要「此刻在轨目标的真实位置」，共 15,934 个。若运行期用 SGP4 解算，
 *   需要携带 2.4 MB 的 TLE 文本；而这些目标在第一章的时间轴上并不移动，
 *   因此把位置在构建期解算好，写成二进制点云，运行期直接上传 GPU。
 *
 *   第三、四章的碎片必须随时间轴拖动实时解算，因此保留 TLE 由 SGP4 运行期计算。
 *   碎片只有 2,676 个，TLE 体积可接受。
 *
 * 与 SATCAT 的连接：
 *   每个对象附带 SATCAT 的运行状态与对象类型。第一章的核心论点是
 *   「编目里大部分东西已经不能工作了」，这需要按状态筛选与计数，
 *   而 GP 根数本身不含该信息。
 *
 * 用法：node scripts/build-runtime-data.mjs
 * 产出：public/data/catalog.bin        在轨编目点云（构建期解算，运行期不解算）
 *       public/data/catalog-meta.json
 *       public/data/debris.tle         碎片轨道根数（运行期由 SGP4 解算）
 *       public/data/debris-meta.json
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as satellite from 'satellite.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');

// 数据历元：作品时间轴的锚点。所有快照位置都在此刻解算。
// 2026-10-13 是本次数据获取日，选它作为历元可使解算精度最高。
const EPOCH = new Date('2026-10-13T00:00:00Z');

const DEBRIS_FILES = [
  { file: 'fengyun-1c-debris.tle', key: 'fengyun1c', label: '风云一号C碎片', event: '2007-01-11' },
  { file: 'cosmos-2251-debris.tle', key: 'cosmos2251', label: '宇宙2251碎片', event: '2009-02-10' },
  { file: 'iridium-33-debris.tle', key: 'iridium33', label: '铱星33碎片', event: '2009-02-10' },
];

/**
 * 对象类别编码。第一章按此区分「还在工作的」与「已经不工作的」。
 * 取值顺序即渲染时的分组顺序。
 */
const CATEGORY = {
  WORKING_PAYLOAD: 0, // 有效载荷，运行状态为正常
  DEAD_PAYLOAD: 1, // 有效载荷，已失效 / 备用 / 待机 / 已废弃 / 无状态记录
  ROCKET_BODY: 2, // 火箭残骸
  DEBRIS: 3, // 碎片
  UNKNOWN: 4, // 未分类
};

const CATEGORY_LABEL = {
  0: '工作中的载荷',
  1: '已失效的载荷',
  2: '火箭残骸',
  3: '碎片',
  4: '未分类',
};

/** 解析 TLE 文本为 { name, line1, line2 } 数组。 */
function parseTle(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trimEnd()).filter((s) => s.length > 0);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      const prev = lines[i - 1];
      const name = prev && !prev.startsWith('1 ') && !prev.startsWith('2 ') ? prev.trim() : '';
      out.push({ name, line1: lines[i], line2: lines[i + 1] });
      i += 1;
    }
  }
  return out;
}

/** 按 RFC 4180 拆分一行 CSV（OBJECT_NAME 可能含逗号）。 */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** 读取 SATCAT，返回 NORAD 编号 → 状态信息的表。 */
async function loadSatcat() {
  const file = path.join(RAW, 'satcat.csv');
  if (!existsSync(file)) {
    console.warn('未找到 data/raw/satcat.csv，跳过分状态着色（先运行 scripts/fetch-satcat.mjs）');
    return new Map();
  }
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const map = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCsvLine(lines[i]);
    const id = (c[idx.NORAD_CAT_ID] ?? '').trim();
    if (!id) continue;
    map.set(id, {
      type: (c[idx.OBJECT_TYPE] ?? '').trim(),
      status: (c[idx.OPS_STATUS_CODE] ?? '').trim(),
      owner: (c[idx.OWNER] ?? '').trim(),
    });
  }
  return map;
}

/** 把 SATCAT 记录映射为类别编码。 */
function categoryOf(satcat) {
  if (!satcat) return CATEGORY.UNKNOWN;
  switch (satcat.type) {
    case 'PAY':
      return satcat.status === '+' ? CATEGORY.WORKING_PAYLOAD : CATEGORY.DEAD_PAYLOAD;
    case 'R/B':
      return CATEGORY.ROCKET_BODY;
    case 'DEB':
      return CATEGORY.DEBRIS;
    default:
      return CATEGORY.UNKNOWN;
  }
}

/**
 * 从 TLE 第一行取国际编号，推出发射年份。
 * 第一行第 10–17 字符为国际编号，格式如 "98067A" → 1998 年。
 */
function launchYear(line1) {
  const desig = line1.slice(9, 17).trim();
  const m = desig.match(/^(\d{2})(\d{3})/);
  if (!m) return null;
  const yy = parseInt(m[1], 10);
  return yy >= 57 ? 1900 + yy : 2000 + yy;
}

/**
 * 从 TLE 第二行取轨道要素。
 * 近地点高度是决定碎片大气寿命的关键量，因此单独保留。
 */
function elements(line2) {
  const R_EARTH = 6378.137;
  const MU = 398600.4418;
  const ecc = parseFloat(`0.${line2.slice(26, 33).trim()}`);
  const incl = parseFloat(line2.slice(8, 16));
  const nRevPerDay = parseFloat(line2.slice(52, 63));
  const n = (nRevPerDay * 2 * Math.PI) / 86400;
  const a = Math.cbrt(MU / (n * n));
  return { ecc, incl, perigee: a * (1 - ecc) - R_EARTH, apogee: a * (1 + ecc) - R_EARTH };
}

/** 轨道类型编码：供着色与统计使用。 */
function orbitClass(perigee, apogee) {
  if (perigee < 2000) return 0; // LEO
  if (apogee - perigee < 200 && perigee > 30000) return 1; // GEO
  if (perigee > 30000) return 2; // HEO
  if (perigee >= 2000 && perigee < 30000) return 3; // MEO
  return 4;
}

const ORBIT_CLASS_LABEL = ['LEO', 'GEO', 'HEO', 'MEO', 'OTHER'];

async function main() {
  await mkdir(OUT, { recursive: true });
  const satcat = await loadSatcat();

  // ---------- 第一章：在轨编目点云 ----------
  const catalog = parseTle(await readFile(path.join(RAW, 'catalog.tle'), 'utf8'));

  // 地心惯性系 → 地固系的旋转角（格林尼治恒星时）。
  //
  // 为什么必须转换：SGP4 输出的是惯性系坐标，而地球在自转。若直接把惯性系
  // 坐标画在会自转的地球上，卫星相对地面会持续漂移，看起来「卫星在动」，
  // 实际是把地球自转重复计了一次。转到地固系后，位置与地理的对应关系
  // 在历元时刻是真实成立的，地球与点云可以作为一个整体旋转。
  const gmst = satellite.gstime(EPOCH);
  const cosG = Math.cos(gmst);
  const sinG = Math.sin(gmst);

  // 每个对象 7 个 float32：地固坐标 xyz + 发射年 + 轨道类别 + 近地点 + 对象类别。
  // 位置用三维坐标而非经纬度，避免极区收敛与高轨分辨率问题。
  const FIELDS = ['ecefX', 'ecefY', 'ecefZ', 'launchYear', 'orbitClass', 'perigeeKm', 'category'];
  const stride = FIELDS.length;
  const buf = new Float32Array(catalog.length * stride);

  let failed = 0;
  let satcatMatched = 0;
  const yearHist = {};
  const classHist = {};
  const catHist = {};

  for (let i = 0; i < catalog.length; i += 1) {
    const { line1, line2 } = catalog[i];
    const o = i * stride;

    const rec = satellite.twoline2satrec(line1, line2);
    const pv = satellite.propagate(rec, EPOCH);
    if (pv?.position && Number.isFinite(pv.position.x)) {
      // 绕 Z 轴旋转 -GMST：把惯性系坐标转到随地球自转的地固系
      const { x, y, z } = pv.position;
      buf[o] = x * cosG + y * sinG;
      buf[o + 1] = -x * sinG + y * cosG;
      buf[o + 2] = z;
    } else {
      buf[o] = buf[o + 1] = buf[o + 2] = NaN;
      failed += 1;
    }

    const yr = launchYear(line1) ?? 0;
    buf[o + 3] = yr;
    yearHist[yr] = (yearHist[yr] || 0) + 1;

    const el = elements(line2);
    const cls = orbitClass(el.perigee, el.apogee);
    buf[o + 4] = cls;
    classHist[ORBIT_CLASS_LABEL[cls]] = (classHist[ORBIT_CLASS_LABEL[cls]] || 0) + 1;
    buf[o + 5] = el.perigee;

    const norad = line2.slice(2, 7).trim();
    const sc = satcat.get(norad);
    if (sc) satcatMatched += 1;
    const cat = categoryOf(sc);
    buf[o + 6] = cat;
    catHist[CATEGORY_LABEL[cat]] = (catHist[CATEGORY_LABEL[cat]] || 0) + 1;
  }

  await writeFile(path.join(OUT, 'catalog.bin'), Buffer.from(buf.buffer));
  await writeFile(
    path.join(OUT, 'catalog-meta.json'),
    JSON.stringify(
      {
        epoch: EPOCH.toISOString(),
        source: 'CelesTrak',
        count: catalog.length,
        failed,
        stride,
        fields: FIELDS,
        orbitClassLabels: ORBIT_CLASS_LABEL,
        categoryLabels: CATEGORY_LABEL,
        orbitClasses: classHist,
        categories: catHist,
        yearHistogram: yearHist,
        units: { position: 'km', perigee: 'km' },
      },
      null,
      2
    ),
    'utf8'
  );

  // ---------- 第三、四章：碎片轨道根数 ----------
  const debrisLines = [];
  const debrisMeta = [];
  let offset = 0;

  for (const d of DEBRIS_FILES) {
    const objs = parseTle(await readFile(path.join(RAW, d.file), 'utf8'));
    const perigees = [];
    for (const o of objs) {
      debrisLines.push(o.line1, o.line2);
      perigees.push(elements(o.line2).perigee);
      offset += 1;
    }
    perigees.sort((a, b) => a - b);
    debrisMeta.push({
      key: d.key,
      label: d.label,
      event: d.event,
      color: d.key === 'fengyun1c' ? '#ff7a45' : d.key === 'cosmos2251' ? '#4fc3f7' : '#ffd54f',
      count: objs.length,
      perigeeMinKm: +perigees[0].toFixed(1),
      perigeeMedianKm: +perigees[Math.floor(perigees.length / 2)].toFixed(1),
      perigeeMaxKm: +perigees[perigees.length - 1].toFixed(1),
      above800km: perigees.filter((x) => x >= 800).length,
    });
  }

  await writeFile(path.join(OUT, 'debris.tle'), debrisLines.join('\n') + '\n', 'utf8');
  await writeFile(
    path.join(OUT, 'debris-meta.json'),
    JSON.stringify({ epoch: EPOCH.toISOString(), source: 'CelesTrak', total: offset, groups: debrisMeta }, null, 2),
    'utf8'
  );

  // ---------- 报告 ----------
  const catalogBin = (await stat(path.join(OUT, 'catalog.bin'))).size;
  const debrisTle = (await stat(path.join(OUT, 'debris.tle'))).size;
  const gz = async (p) => gzipSync(await readFile(p), { level: 9 }).length;

  console.log('=== 第一章：在轨编目点云 ===');
  console.log(`  对象数        ${catalog.length.toLocaleString()}`);
  console.log(`  解算失败      ${failed}`);
  console.log(`  状态匹配      ${satcatMatched.toLocaleString()} / ${catalog.length.toLocaleString()}`);
  console.log(`  二进制体积    ${(catalogBin / 1024).toFixed(1)} KB (未压缩)`);
  console.log('  轨道类型      ' + Object.entries(classHist).map(([k, v]) => `${k} ${v}`).join(' / '));
  console.log('  对象类别      ' + Object.entries(catHist).map(([k, v]) => `${k} ${v}`).join(' / '));
  const years = Object.keys(yearHist).map(Number).filter((y) => y > 0).sort();
  console.log(`  发射年份范围  ${years[0]} – ${years[years.length - 1]}`);

  console.log('\n=== 第三、四章：碎片 ===');
  for (const g of debrisMeta) {
    console.log(
      `  ${g.label.padEnd(14)} ${String(g.count).padStart(5)} 个 | 近地点中位 ${g.perigeeMedianKm} km | ≥800km ${g.above800km}`
    );
  }
  console.log(`  TLE 体积      ${(debrisTle / 1024).toFixed(1)} KB (未压缩)`);

  console.log('\n=== 运行时数据总量 ===');
  const gzTotal = (await gz(path.join(OUT, 'catalog.bin'))) + (await gz(path.join(OUT, 'debris.tle')));
  console.log(`  未压缩        ${((catalogBin + debrisTle) / 1024).toFixed(0)} KB`);
  console.log(`  gzip 后       ${(gzTotal / 1024).toFixed(0)} KB`);
  console.log('\n已写入 public/data/');
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
