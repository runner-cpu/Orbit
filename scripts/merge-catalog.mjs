#!/usr/bin/env node
/**
 * 把 data/raw 下的多个轨道分组合并为一份去重的编目快照。
 *
 * 用途：第一章需要一个「当前在轨目标全景」图层。CelesTrak 按分组提供数据，
 * 不同分组之间存在重复对象（例如同一颗卫星可能同时属于某个星座分组与
 * 某个用途分组），因此必须按 NORAD 编号去重。
 *
 * 用法：node scripts/merge-catalog.mjs
 * 产出：data/raw/catalog.tle   去重后的合并编目
 *       data/catalog.json      分组构成与去重统计
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RAW = path.join(ROOT, 'data', 'raw');

// 这些文件是「碎片群」，属于第三、四章的内容，不并入第一章的全景编目。
const DEBRIS_FILES = new Set([
  'fengyun-1c-debris.tle',
  'cosmos-2251-debris.tle',
  'iridium-33-debris.tle',
]);

const R_EARTH = 6378.137;
const MU = 398600.4418;

/** 解析 TLE 文本为 [name, line1, line2] 三元组。 */
function splitTle(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trimEnd()).filter((s) => s.length > 0);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      const prev = lines[i - 1];
      const name = prev && !prev.startsWith('1 ') && !prev.startsWith('2 ')
        ? prev.trim()
        : `OBJECT-${lines[i].slice(2, 7).trim()}`;
      out.push([name, lines[i], lines[i + 1]]);
      i += 1;
    }
  }
  return out;
}

/** 取 TLE 第二行的 NORAD 编目号，用于去重。 */
function noradId(line2) {
  return line2.slice(2, 7).trim();
}

/** 由 TLE 反推轨道高度，用于给第一章的分层着色提供依据。 */
function altitudeOf(line1, line2) {
  const ecc = parseFloat(`0.${line2.slice(26, 33).trim()}`);
  const nRevPerDay = parseFloat(line2.slice(52, 63));
  const n = (nRevPerDay * 2 * Math.PI) / 86400;
  const a = Math.cbrt(MU / (n * n));
  return {
    perigee: a * (1 - ecc) - R_EARTH,
    apogee: a * (1 + ecc) - R_EARTH,
    inclination: parseFloat(line2.slice(8, 16)),
  };
}

/** 按轨道高度归类，供页面分层着色与统计。 */
function orbitClass(perigee, apogee) {
  if (perigee < 2000) return 'LEO';
  if (apogee - perigee < 200 && perigee > 30000) return 'GEO';
  if (perigee > 30000 && apogee > 30000) return 'HEO';
  if (perigee >= 2000 && perigee < 30000) return 'MEO';
  return 'OTHER';
}

async function main() {
  const files = (await readdir(RAW)).filter((f) => f.endsWith('.tle')).sort();

  const byId = new Map(); // noradId -> { name, line1, line2, groups: [] }
  const perGroup = {};

  for (const file of files) {
    if (file === 'catalog.tle') continue;
    const isDebris = DEBRIS_FILES.has(file);

    let triples;
    try {
      triples = splitTle(await readFile(path.join(RAW, file), 'utf8'));
    } catch {
      continue;
    }
    if (triples.length === 0) continue;

    perGroup[file] = { objects: triples.length, role: isDebris ? 'debris' : 'catalog' };
    if (isDebris) continue; // 碎片群不并入全景编目

    for (const [name, l1, l2] of triples) {
      const id = noradId(l2);
      const existing = byId.get(id);
      if (existing) {
        existing.groups.push(file);
      } else {
        byId.set(id, { name, line1: l1, line2: l2, groups: [file] });
      }
    }
  }

  const entries = [...byId.entries()];
  const classes = { LEO: 0, MEO: 0, GEO: 0, HEO: 0, OTHER: 0 };
  const altitudes = [];

  for (const [id, o] of entries) {
    const a = altitudeOf(o.line1, o.line2);
    altitudes.push(a.perigee);
    classes[orbitClass(a.perigee, a.apogee)] += 1;
    o.id = id;
    o.alt = a;
  }

  // 按轨道高度排序写出，便于页面按下标分段渲染
  const sorted = entries.slice().sort((a, b) => a[1].alt.perigee - b[1].alt.perigee);
  const sortedLines = [];
  for (const [, o] of sorted) sortedLines.push(o.name, o.line1, o.line2);

  await writeFile(path.join(RAW, 'catalog.tle'), sortedLines.join('\n') + '\n', 'utf8');

  altitudes.sort((x, y) => x - y);
  const q = (p) => altitudes[Math.min(altitudes.length - 1, Math.floor(p * (altitudes.length - 1)))];

  const meta = {
    generatedAt: new Date().toISOString(),
    perGroup,
    merged: {
      rawObjectsAcrossFiles: Object.entries(perGroup)
        .filter(([, v]) => v.role === 'catalog')
        .reduce((s, [, v]) => s + v.objects, 0),
      uniqueObjects: entries.length,
      duplicatesRemoved:
        Object.entries(perGroup)
          .filter(([, v]) => v.role === 'catalog')
          .reduce((s, [, v]) => s + v.objects, 0) - entries.length,
    },
    orbitClasses: classes,
    perigeeKm: {
      min: +q(0).toFixed(1),
      p25: +q(0.25).toFixed(1),
      median: +q(0.5).toFixed(1),
      p75: +q(0.75).toFixed(1),
      max: +q(1).toFixed(1),
    },
  };

  await writeFile(path.join(ROOT, 'data', 'catalog.json'), JSON.stringify(meta, null, 2), 'utf8');

  console.log('=== 分组构成 ===');
  for (const [f, v] of Object.entries(perGroup)) {
    console.log(`  ${f.padEnd(28)} ${String(v.objects).padStart(5)}  ${v.role}`);
  }
  console.log('\n=== 合并结果 ===');
  console.log(`  合并前合计      ${meta.merged.rawObjectsAcrossFiles}`);
  console.log(`  去重后唯一对象  ${meta.merged.uniqueObjects}`);
  console.log(`  移除重复        ${meta.merged.duplicatesRemoved}`);
  console.log('\n=== 轨道类型分布 ===');
  for (const [k, v] of Object.entries(classes)) console.log(`  ${k.padEnd(6)} ${String(v).padStart(5)}`);
  console.log('\n=== 近地点高度 (km) ===');
  const p = meta.perigeeKm;
  console.log(`  min ${p.min}  p25 ${p.p25}  中位 ${p.median}  p75 ${p.p75}  max ${p.max}`);
  console.log('\n已写入 data/raw/catalog.tle 与 data/catalog.json');
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
