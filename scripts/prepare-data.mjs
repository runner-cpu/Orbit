#!/usr/bin/env node
/**
 * 冻结 CelesTrak 公共轨道数据，并计算近地轨道碎片云的统计特征。
 *
 * 用法：node scripts/prepare-data.mjs [--force]
 * 产出：data/raw/*.tle        原始两行轨道根数（离线可用的数据快照）
 *       data/summary.json     统计结果，供方案与页面文案引用
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RAW = path.join(ROOT, 'data', 'raw');

const R_EARTH = 6378.137; // km
const MU = 398600.4418; // km^3/s^2
const FETCH_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const FORCE = process.argv.includes('--force');

// 需要联网补抓的数据集。三个碎片群已随项目冻结，这里只补参考星座。
const TO_FETCH = [
  { group: 'stations', file: 'stations.tle' },
  { group: 'gps-ops', file: 'gps-ops.tle' },
];

const DEBRIS = [
  { key: 'fengyun1c', label: '风云一号C碎片', file: 'fengyun-1c-debris.tle', event: '2007-01-11' },
  { key: 'cosmos2251', label: '宇宙2251碎片', file: 'cosmos-2251-debris.tle', event: '2009-02-10' },
  { key: 'iridium33', label: '铱星33碎片', file: 'iridium-33-debris.tle', event: '2009-02-10' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 CelesTrak 抓取一个分组，返回 TLE 文本；失败返回 null。 */
async function fetchGroup(group) {
  const url = `${FETCH_BASE}?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'orbit-story/0.1 (educational science communication)' },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    // CelesTrak 在数据未更新或触发限流时返回的是说明文字而非 TLE。
    if (!/^1 /m.test(text)) return { error: text.trim().slice(0, 160) };
    return { text };
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

/** 把 TLE 文本切成 [name, line1, line2] 三元组。 */
function splitTle(text) {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0);
  const triples = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('1 ') && lines[i + 1] && lines[i + 1].startsWith('2 ')) {
      const name = i > 0 && !lines[i - 1].startsWith('1 ') && !lines[i - 1].startsWith('2 ')
        ? lines[i - 1]
        : `OBJECT-${lines[i].slice(2, 7).trim()}`;
      triples.push([name, lines[i], lines[i + 1]]);
      i += 1;
    }
  }
  return triples;
}

/** 由 TLE 第二行解算轨道要素。用开普勒第三定律从平均运动反推半长轴。 */
function elements(line1, line2) {
  const epochYear = 2000 + parseInt(line1.slice(18, 20), 10);
  const epochDay = parseFloat(line1.slice(20, 32));
  const epoch = new Date(Date.UTC(epochYear, 0, 1) + (epochDay - 1) * 86400000);

  const inclination = parseFloat(line2.slice(8, 16));
  const raan = parseFloat(line2.slice(17, 25));
  const ecc = parseFloat(`0.${line2.slice(26, 33).trim()}`);
  const nRevPerDay = parseFloat(line2.slice(52, 63));

  const n = (nRevPerDay * 2 * Math.PI) / 86400; // rad/s
  const a = Math.cbrt(MU / (n * n)); // km
  const perigee = a * (1 - ecc) - R_EARTH;
  const apogee = a * (1 + ecc) - R_EARTH;

  return { epoch, inclination, raan, ecc, nRevPerDay, a, perigee, apogee };
}

function quantiles(values) {
  const v = values.slice().sort((x, y) => x - y);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  return {
    min: +q(0).toFixed(1),
    p25: +q(0.25).toFixed(1),
    median: +q(0.5).toFixed(1),
    p75: +q(0.75).toFixed(1),
    max: +q(1).toFixed(1),
  };
}

/** 高度直方图，用于判断碎片集中在哪一层壳。 */
function histogram(values, start, end, step) {
  const buckets = [];
  for (let lo = start; lo < end; lo += step) {
    const hi = lo + step;
    const count = values.filter((x) => x >= lo && x < hi).length;
    if (count > 0) buckets.push({ range: `${lo}-${hi}`, lo, hi, count });
  }
  return buckets;
}

async function main() {
  await mkdir(RAW, { recursive: true });

  // 1) 补抓需要联网的数据集
  const fetched = [];
  for (const item of TO_FETCH) {
    const dest = path.join(RAW, item.file);
    if (existsSync(dest) && !FORCE) {
      fetched.push({ ...item, status: 'cached' });
      continue;
    }
    const res = await fetchGroup(item.group);
    if (res.text) {
      await writeFile(dest, res.text, 'utf8');
      fetched.push({ ...item, status: 'ok', bytes: Buffer.byteLength(res.text) });
    } else {
      fetched.push({ ...item, status: 'failed', error: res.error });
    }
    await sleep(2500); // CelesTrak 建议同一分组两小时内不重复请求
  }

  // 2) 统计三个碎片群
  const summary = {
    generatedAt: new Date().toISOString(),
    earthRadiusKm: R_EARTH,
    fetches: fetched,
    debrisClouds: {},
  };

  for (const d of DEBRIS) {
    const file = path.join(RAW, d.file);
    if (!existsSync(file)) {
      summary.debrisClouds[d.key] = { label: d.label, error: '文件缺失' };
      continue;
    }
    const triples = splitTle(readFileSync(file, 'utf8'));
    const els = triples.map(([, l1, l2]) => elements(l1, l2));
    const perigees = els.map((e) => e.perigee);
    const apogees = els.map((e) => e.apogee);
    const incls = els.map((e) => e.inclination);
    const epochs = els.map((e) => e.epoch.getTime());

    summary.debrisClouds[d.key] = {
      label: d.label,
      event: d.event,
      source: 'CelesTrak',
      sourceFile: d.file,
      count: els.length,
      epochRange: [
        new Date(Math.min(...epochs)).toISOString().slice(0, 10),
        new Date(Math.max(...epochs)).toISOString().slice(0, 10),
      ],
      altitude: {
        perigee: quantiles(perigees),
        apogee: quantiles(apogees),
        histogram: histogram(perigees, 200, 1600, 50),
      },
      inclination: {
        ...quantiles(incls),
        spread: +(Math.max(...incls) - Math.min(...incls)).toFixed(2),
      },
      eccentricityMax: +Math.max(...els.map((e) => e.ecc)).toFixed(4),
      above600km: perigees.filter((x) => x >= 600).length,
      above800km: perigees.filter((x) => x >= 800).length,
    };
  }

  await writeFile(path.join(ROOT, 'data', 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  // 3) 打印摘要
  console.log('=== 数据冻结 ===');
  for (const f of fetched) {
    console.log(`  ${f.file.padEnd(24)} ${f.status}${f.error ? ` (${f.error})` : ''}`);
  }
  console.log('\n=== 碎片云统计 ===');
  for (const [key, c] of Object.entries(summary.debrisClouds)) {
    if (c.error) {
      console.log(`  ${key}: ${c.error}`);
      continue;
    }
    const p = c.altitude.perigee;
    console.log(
      `  ${c.label.padEnd(14)} ${String(c.count).padStart(5)} 个 | ` +
        `近地点 ${p.min}-${p.max} km (中位 ${p.median}) | ` +
        `倾角 ${c.inclination.min}-${c.inclination.max}° | ` +
        `≥800km ${c.above800km} 个`
    );
  }
  const buckets = summary.debrisClouds.fengyun1c?.altitude?.histogram ?? [];
  if (buckets.length) {
    console.log('\n  风云一号C碎片高度分布（近地点，50km 分箱）:');
    const peak = Math.max(...buckets.map((b) => b.count));
    for (const b of buckets) {
      const bar = '█'.repeat(Math.max(1, Math.round((b.count / peak) * 40)));
      console.log(`    ${b.range.padStart(9)} km  ${String(b.count).padStart(4)}  ${bar}`);
    }
  }
  console.log('\n已写入 data/summary.json');
}

main().catch((err) => {
  console.error('失败:', err);
  process.exit(1);
});
