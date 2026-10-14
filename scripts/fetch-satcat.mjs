#!/usr/bin/env node
/**
 * 冻结 CelesTrak 的 SATCAT 卫星编目（Satellite Catalog）。
 *
 * 为什么需要这份数据：
 *   GP 轨道根数（TLE）只覆盖「有维护根数的对象」，无法回答「轨道上到底有多少东西」
 *   以及「其中多少还在工作」。SATCAT 是 CelesTrak 发布的完整编目记录，每条包含
 *   对象类型（载荷 / 火箭残骸 / 碎片）与运行状态码，可以给出总量与构成。
 *
 *   第一章需要引用的两个数字（在轨总数、仍在工作的载荷数）都来自这里，
 *   因此必须冻结成离线快照，保证页面数字与脚本输出一致、可复核。
 *
 * 用法：node scripts/fetch-satcat.mjs [--force]
 * 产出：data/raw/satcat.csv            冻结的原始编目（离线快照）
 *       public/data/population.json    运行时读取的构成统计
 *       data/population.json           同一份数据的留档副本，供核对与引用
 */
import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
const SATCAT = path.join(RAW, 'satcat.csv');
const FORCE = process.argv.includes('--force');

const URL_SATCAT = 'https://celestrak.org/pub/satcat.csv';

/**
 * 按 RFC 4180 拆分一行 CSV。
 * OBJECT_NAME 里可能出现逗号与引号（例如 "THORAD AGENA D R/B (2)"），
 * 直接 split(',') 会错位，因此必须处理引号状态。
 */
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
      } else {
        quoted = !quoted;
      }
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

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = cells[i] ?? '';
    return row;
  });
}

/** 对象类型码 → 中文标签。SATCAT 官方定义见 CelesTrak 文档。 */
const TYPE_LABEL = {
  PAY: '有效载荷',
  'R/B': '火箭残骸',
  DEB: '碎片',
  UNK: '未分类',
};

async function download() {
  const res = await fetch(URL_SATCAT, {
    headers: { 'User-Agent': 'orbit-story/0.1 (educational science communication)' },
  });
  if (!res.ok) throw new Error(`SATCAT 下载失败：HTTP ${res.status}`);
  const text = await res.text();
  // 限流时 CelesTrak 返回说明文字而非 CSV，用表头做一次校验
  if (!text.startsWith('OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID')) {
    throw new Error(`返回内容不是 SATCAT：${text.trim().slice(0, 160)}`);
  }
  await writeFile(SATCAT, text, 'utf8');
  return text;
}

async function main() {
  await mkdir(RAW, { recursive: true });

  let text;
  if (existsSync(SATCAT) && !FORCE) {
    text = await readFile(SATCAT, 'utf8');
    console.log('使用已冻结的 data/raw/satcat.csv（加 --force 可重新抓取）');
  } else {
    console.log(`抓取 ${URL_SATCAT} …`);
    text = await download();
    console.log(`已写入 data/raw/satcat.csv（${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB）`);
  }

  const rows = parseCsv(text);
  console.log(`编目记录总数（含已再入）  ${rows.length.toLocaleString()}`);

  // 「在轨」判据：DECAY_DATE 为空表示尚未陨落。
  // 这是 CelesTrak 给出的口径，可与页面的方法说明对照。
  const inOrbit = rows.filter((r) => !r.DECAY_DATE.trim());
  console.log(`其中仍在轨              ${inOrbit.length.toLocaleString()}`);

  const byType = {};
  const byTypeStatus = {};
  for (const r of inOrbit) {
    const t = r.OBJECT_TYPE.trim() || 'UNK';
    byType[t] = (byType[t] || 0) + 1;
    const s = r.OPS_STATUS_CODE.trim() || '(空白)';
    byTypeStatus[t] = byTypeStatus[t] || {};
    byTypeStatus[t][s] = (byTypeStatus[t][s] || 0) + 1;
  }

  // 运行状态码含义（CelesTrak SATCAT 格式说明）：
  //   +  正常运行    -  失效/停止工作    P  部分运行    B  备用
  //   S  待机        X  已废弃           D  已陨落      (空白) 无状态记录
  //
  // 分组口径说明：只有 "+" 才算「仍在工作」。P/B/S 归入「非正常状态」而不是
  // 失效，因为待机或部分运行的载荷仍有恢复可能；空白是编目未记录状态，
  // 不能当成失效来用。这三类合并为「未在正常工作」并在页面逐项列出。
  const payloads = inOrbit.filter((r) => r.OBJECT_TYPE.trim() === 'PAY');
  const statusCount = {};
  for (const r of payloads) {
    const s = r.OPS_STATUS_CODE.trim() || '(空白)';
    statusCount[s] = (statusCount[s] || 0) + 1;
  }
  const working = statusCount['+'] ?? 0;
  const failed = statusCount['-'] ?? 0;
  const retired = statusCount.X ?? 0;
  const partial = (statusCount.P ?? 0) + (statusCount.B ?? 0) + (statusCount.S ?? 0);
  const unrecorded = statusCount['(空白)'] ?? 0;
  const notWorkingPayloads = failed + retired + partial + unrecorded;

  // 在轨构成：五类互斥，合计等于在轨总数。这是第一章「反直觉」论点的分母。
  const breakdown = [
    { key: 'working', label: '正在工作的载荷', count: working },
    { key: 'debris', label: '碎片', count: byType.DEB ?? 0 },
    { key: 'failed', label: '已失效的载荷', count: failed + retired },
    { key: 'partial', label: '部分运行或待机的载荷', count: partial },
    { key: 'rocket', label: '火箭残骸', count: byType['R/B'] ?? 0 },
    { key: 'unrecorded', label: '状态未记录的载荷', count: unrecorded },
    { key: 'unknown', label: '未分类', count: byType.UNK ?? 0 },
  ].map((r) => ({ ...r, share: +((r.count / inOrbit.length) * 100).toFixed(1) }));

  const breakdownSum = breakdown.reduce((s, r) => s + r.count, 0);

  // ---------- 近地点高度分布 ----------
  //
  // 第一章要说清「东西挤在哪一层」，而三维场景只能画出有公开轨道根数的对象
  // （15,934 个）。剩下 19,407 个编目在轨物体没有公开根数，无法定位，
  // 但它们的高度记录在 SATCAT 的 PERIGEE 字段里，因此可以用分布图如实呈现。
  //
  // 分箱边界按物理意义选取，而非等距：600 km 以上大气阻力开始显著减弱，
  // 800 km 以上几乎不再起清除作用，这两个阈值是后续章节的论证基础。
  const BANDS = [
    { label: '200-400 km', lo: 200, hi: 400 },
    { label: '400-500 km', lo: 400, hi: 500 },
    { label: '500-600 km', lo: 500, hi: 600 },
    { label: '600-700 km', lo: 600, hi: 700 },
    { label: '700-800 km', lo: 700, hi: 800 },
    { label: '800-1000 km', lo: 800, hi: 1000 },
    { label: '1000-1500 km', lo: 1000, hi: 1500 },
    { label: '1500-2000 km', lo: 1500, hi: 2000 },
    { label: '2000 km 以上', lo: 2000, hi: Infinity },
  ];

  const altitude = BANDS.map((b) => ({ ...b, total: 0, PAY: 0, 'R/B': 0, DEB: 0, UNK: 0 }));
  let noPerigee = 0;
  for (const r of inOrbit) {
    const perigee = parseFloat(r.PERIGEE);
    if (!Number.isFinite(perigee)) {
      noPerigee += 1;
      continue;
    }
    const bi = altitude.findIndex((b) => perigee >= b.lo && perigee < b.hi);
    if (bi < 0) {
      noPerigee += 1;
      continue;
    }
    const t = r.OBJECT_TYPE.trim() || 'UNK';
    altitude[bi].total += 1;
    altitude[bi][t] = (altitude[bi][t] ?? 0) + 1;
  }
  const altitudeSum = altitude.reduce((s, b) => s + b.total, 0);
  for (const b of altitude) b.share = +((b.total / altitudeSum) * 100).toFixed(1);

  // 按对象类型的原始口径，供二次核对使用（与 breakdown 的分法不同：
  // breakdown 按「是否还能工作」切，composition 按编目类型切）。
  const composition = Object.keys(TYPE_LABEL)
    .map((code) => ({
      code,
      label: TYPE_LABEL[code],
      count: byType[code] ?? 0,
      share: +(((byType[code] ?? 0) / inOrbit.length) * 100).toFixed(1),
    }))
    .sort((a, b) => b.count - a.count);

  const rocketsAndDebris =
    (byType['R/B'] ?? 0) + (byType.DEB ?? 0) + (byType.UNK ?? 0);

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'CelesTrak SATCAT',
    sourceUrl: URL_SATCAT,
    sourceNote:
      'CelesTrak 公开发布的卫星编目记录。在轨判据为 DECAY_DATE 字段为空；运行状态取自 OPS_STATUS_CODE，仅 "+" 计为正在工作。',
    totalCatalogued: rows.length,
    inOrbit: inOrbit.length,
    workingPayloads: working,
    payloadsInOrbit: payloads.length,
    failedPayloadsTracked: failed + retired,
    notWorkingPayloads,
    nonPayloadObjects: rocketsAndDebris,
    nonWorkingShare: +(((inOrbit.length - working) / inOrbit.length) * 100).toFixed(1),
    breakdown,
    breakdownSum,
    altitudeDistribution: {
      bands: altitude,
      sum: altitudeSum,
      noPerigee,
      unit: 'km',
      note: '高度为近地点高度（PERIGEE 字段）。近地点决定大气阻力作用强度，是判断物体能在轨停留多久的关键量；远地点不用于本分布。',
    },
    composition,
    statusCount,
    byTypeStatus,
    statusCodes: {
      '+': '正常运行',
      '-': '已失效',
      P: '部分运行',
      B: '备用',
      S: '待机',
      X: '已废弃',
      D: '已陨落',
      '(空白)': '无状态记录',
    },
  };

  const json = JSON.stringify(out, null, 2);
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'population.json'), json, 'utf8');
  await writeFile(path.join(ROOT, 'data', 'population.json'), json, 'utf8');

  console.log('\n=== 在轨构成（SATCAT 口径）===');
  for (const c of breakdown) {
    console.log(
      `  ${c.label.padEnd(12)} ${String(c.count).padStart(7)}  ${String(c.share).padStart(5)}%`
    );
  }
  console.log(`  ${'合计'.padEnd(12)} ${String(breakdownSum).padStart(7)}`);
  console.log(`\n仍在工作的载荷        ${working.toLocaleString()}`);
  console.log(`非工作对象占比        ${out.nonWorkingShare}%`);

  console.log('\n=== 近地点高度分布（SATCAT，含无法定位的对象）===');
  const maxCount = Math.max(...altitude.map((b) => b.total));
  for (const b of altitude) {
    const bar = '#'.repeat(Math.round((b.total / maxCount) * 40));
    console.log(
      `  ${b.label.padEnd(14)} ${String(b.total).padStart(6)}  ${String(b.share).padStart(5)}%  ${bar}`
    );
  }
  console.log(`  合计 ${altitudeSum.toLocaleString()}（另有 ${noPerigee} 条无高度记录）`);
  console.log('\n已写入 public/data/population.json 与 data/population.json');
}

main().catch((e) => {
  console.error('失败:', e.message || e);
  process.exit(1);
});
