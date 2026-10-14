#!/usr/bin/env node
/**
 * 生成第二章需要的两条历史序列。
 *
 * 为什么单独成一个脚本而不是塞进 build-runtime-data.mjs：
 *   这两条序列的输入是 SATCAT 的编目记录（回答「有多少、什么时候在轨」），
 *   而不是 TLE 轨道根数（回答「在哪里」）。两者口径不同，分开放，
 *   页面「数据与方法」一节才能把口径差异讲清楚。
 *
 * 序列一：在轨数量逐年重建。
 *   对每个年份 Y，统计「发射日期 ≤ Y」且「（未再入）或（再入日期 > Y）」的记录数。
 *   这就得到该年末的在轨编目总量，以及其中碎片部分的量。
 *   注意：这是用今天的编目记录倒推历史，不是当年的实时快照。已再入的对象
 *   若已被移出编目，就不会出现在这里，因此历史值会略低于当年的真实在轨数。
 *   这条限制写在页面上，不藏起来。
 *
 * 序列二：三个碎片家族自身的衰减。
 *   风云一号C / 宇宙2251 / 铱星33 的碎片里有相当一部分已经再入，
 *   按再入年份累计，直接给出「这一个高度层自己清掉多少、剩下多少」。
 *   第五章要用的就是这条：到目前只清掉约三分之一，剩下三分之二还在。
 *
 * 用法：node scripts/build-history.mjs
 * 产出：public/data/history.json
 *       data/history.json    留档副本，供核对与引用
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
const ARCHIVE = path.join(ROOT, 'data');

/** 碎片家族：SATCAT 里 OBJECT_NAME 的前缀。 */
const FAMILIES = [
  { key: 'fengyun1c', label: '风云一号C碎片', event: '2007-01-11', prefix: 'FENGYUN 1C DEB' },
  { key: 'cosmos2251', label: '宇宙2251碎片', event: '2009-02-10', prefix: 'COSMOS 2251 DEB' },
  { key: 'iridium33', label: '铱星33碎片', event: '2009-02-10', prefix: 'IRIDIUM 33 DEB' },
];

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

async function main() {
  const file = path.join(RAW, 'satcat.csv');
  if (!existsSync(file)) {
    throw new Error('缺少 data/raw/satcat.csv，请先运行 npm run satcat');
  }

  const lines = (await readFile(file, 'utf8')).split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  // 一次性读成紧凑记录，避免在逐年循环里反复解析 CSV
  const recs = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCsvLine(lines[i]);
    const launch = (c[idx.LAUNCH_DATE] ?? '').trim();
    if (launch.length < 4) continue;
    const decay = (c[idx.DECAY_DATE] ?? '').trim();
    recs.push({
      ly: Number(launch.slice(0, 4)),
      dy: decay.length >= 4 ? Number(decay.slice(0, 4)) : null,
      type: (c[idx.OBJECT_TYPE] ?? '').trim(),
      name: (c[idx.OBJECT_NAME] ?? '').trim(),
    });
  }

  // ---------- 序列一：在轨数量逐年重建 ----------
  const firstYear = Math.min(...recs.map((r) => r.ly));
  const lastYear = new Date().getUTCFullYear();

  const series = [];
  for (let y = firstYear; y <= lastYear; y += 1) {
    let total = 0;
    let debris = 0;
    for (const r of recs) {
      if (r.ly > y) continue;
      if (r.dy !== null && r.dy <= y) continue;
      total += 1;
      if (r.type === 'DEB') debris += 1;
    }
    series.push({ year: y, inOrbit: total, debris });
  }

  // 逐年增量。第二章的论点「不是线性增长」直接由这一列读出：
  // 有几个年份的增量是相邻年份的数倍，其余年份几乎持平。
  for (let i = 0; i < series.length; i += 1) {
    const prev = i === 0 ? { inOrbit: 0, debris: 0 } : series[i - 1];
    series[i].delta = series[i].inOrbit - prev.inOrbit;
    series[i].deltaDebris = series[i].debris - prev.debris;
  }

  // 跃升点：增量超过该序列自身中位数增量 2.5 倍的年份。
  // 用中位数而不是均值，避免被最大的那一年（1999）把阈值整体抬高。
  const deltas = series.slice(1).map((s) => s.delta).sort((a, b) => a - b);
  const medianDelta = deltas[Math.floor(deltas.length / 2)];
  const jumps = series
    .filter((s) => s.delta > medianDelta * 2.5 && s.delta > 400)
    .map((s) => ({
      year: s.year,
      delta: s.delta,
      inOrbit: s.inOrbit,
      deltaDebris: s.deltaDebris,
      // 该年的增量里多大比例来自碎片。1999、1982 这类年份接近 1，
      // 2020 年之后为负——后期增长完全来自发射，碎片反而在减少。
      debrisShare: s.delta > 0 ? +(s.deltaDebris / s.delta).toFixed(3) : null,
    }));

  // ---------- 序列二：三个碎片家族的衰减 ----------
  const families = FAMILIES.map((f) => {
    const own = recs.filter((r) => r.name.startsWith(f.prefix));
    const total = own.length;
    const alive = own.filter((r) => r.dy === null).length;

    const byYear = new Map();
    for (const r of own) {
      if (r.dy === null) continue;
      byYear.set(r.dy, (byYear.get(r.dy) ?? 0) + 1);
    }
    const eventYear = Number(f.event.slice(0, 4));
    let cum = 0;
    const decay = [];
    for (let y = eventYear; y <= lastYear; y += 1) {
      const n = byYear.get(y) ?? 0;
      cum += n;
      decay.push({ year: y, decayed: n, cumulative: cum, remaining: total - cum });
    }

    return {
      key: f.key,
      label: f.label,
      event: f.event,
      total,
      alive,
      decayed: total - alive,
      /** 到历元为止已经再入的比例（%） */
      decayedShare: +((total - alive) / total * 100).toFixed(1),
      /** 仍然在轨的数量——第五章的核心读数 */
      remaining: alive,
      remainingShare: +((alive / total) * 100).toFixed(1),
      decay,
    };
  });

  // ---------- 序列三：按高度层看「被清除的比例」 ----------
  //
  // 这是第五章的主证据。做法：拿风云一号C 的全部碎片（含已再入的），
  // 按编目记录的近地点分层，统计每层里已经再入的比例。
  //
  // 口径说明（必须写在页面上，否则会被误读）：
  //   已再入对象的 PERIGEE 是它最后一次被记录到的轨道，不是事件发生时的轨道。
  //   因此在「它最终被清除时所处的高度层」这个意义上，这个分层是自洽的：
  //   层层对比得到的是「哪一层更容易把东西交出来」。
  //   绝不能把它读成「碎片诞生时的高度分布」——那要用诞生时刻的根数，
  //   而诞生时刻的根数已经不再维护。
  const BANDS = [
    { lo: 0, hi: 400, label: '400 km 以下' },
    { lo: 400, hi: 500, label: '400–500 km' },
    { lo: 500, hi: 600, label: '500–600 km' },
    { lo: 600, hi: 700, label: '600–700 km' },
    { lo: 700, hi: 750, label: '700–750 km' },
    { lo: 750, hi: 800, label: '750–800 km' },
    { lo: 800, hi: 850, label: '800–850 km' },
    { lo: 850, hi: 900, label: '850–900 km' },
    { lo: 900, hi: Number.POSITIVE_INFINITY, label: '900 km 以上' },
  ];

  // 紧凑记录里没带 PERIGEE，这里单独取一次。
  const perigeeByIdx = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCsvLine(lines[i]);
    if (!(c[idx.OBJECT_NAME] ?? '').startsWith('FENGYUN 1C DEB')) continue;
    const pg = Number.parseFloat(c[idx.PERIGEE]);
    const dd = (c[idx.DECAY_DATE] ?? '').trim();
    if (Number.isFinite(pg)) perigeeByIdx.set(i, { pg, decayed: dd.length > 0 });
  }

  const bands = BANDS.map((b) => ({ ...b, alive: 0, decayed: 0 }));
  for (const [, v] of perigeeByIdx) {
    const bi = bands.findIndex((b) => v.pg >= b.lo && v.pg < b.hi);
    if (bi < 0) continue;
    if (v.decayed) bands[bi].decayed += 1;
    else bands[bi].alive += 1;
  }
  const bandStats = bands
    .map((b) => {
      const total = b.alive + b.decayed;
      return {
        label: b.label,
        lo: b.lo,
        hi: Number.isFinite(b.hi) ? b.hi : null,
        alive: b.alive,
        decayed: b.decayed,
        total,
        // 这一层已经被大气清除掉的比例。第八章的整个论点就压在这一列上：
        // 它从低层的 99% 单调降到 800 km 以上的 0%。
        removedShare: total > 0 ? +((b.decayed / total) * 100).toFixed(1) : null,
      };
    })
    .filter((b) => b.total > 0);

  const bandTotal = bandStats.reduce((s, b) => s + b.total, 0);

  // ---------- 序列四：每一层的衰减时间常数 ----------
  //
  // 这是第五章真正要用的量。做法：对风云一号C 的每个高度层，
  // 把「该年仍留在轨的数量」当成时间序列，用最小二乘拟合 ln N 对时间的斜率，
  // 得到指数衰减的时间常数 τ（N(t) = N0·e^{-t/τ}）。
  //
  // 为什么用拟合而不是直接推算：19 年的实测序列给出的是这个高度层
  // 真实发生过的清除速度，包含真实的大气密度变化（含太阳活动周期）。
  // 比套一个理论大气模型更接近事实，而且全部由编目数据复现。
  //
  // 这一步是**拟合外推**，不是轨道演化仿真。页面上必须这么写。
  // 它的用途是给出量级：一层是几十年清空，另一层是几千年不动。
  const EVENT_YEAR = 2007;
  const bandDecay = [];

  // 收集每个 NORAD 编号的近地点与再入年份，按层归拢
  const bandSeries = bands.map(() => []); // [bandIndex][yearOffset] = remaining
  const bandInit = bands.map(() => 0);
  const perigeeRows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = splitCsvLine(lines[i]);
    if (!(c[idx.OBJECT_NAME] ?? '').startsWith('FENGYUN 1C DEB')) continue;
    const pg = Number.parseFloat(c[idx.PERIGEE]);
    if (!Number.isFinite(pg)) continue;
    const dd = (c[idx.DECAY_DATE] ?? '').trim();
    const dy = dd.length >= 4 ? Number(dd.slice(0, 4)) : null;
    perigeeRows.push({ pg, dy });
  }

  bands.forEach((b, bi) => {
    const own = perigeeRows.filter((r) => r.pg >= b.lo && r.pg < b.hi);
    bandInit[bi] = own.length;
    // 事件当年（2007）之后逐年的剩余量
    for (let y = EVENT_YEAR; y <= lastYear; y += 1) {
      const remaining = own.filter((r) => r.dy === null || r.dy > y).length;
      bandSeries[bi].push({ t: y - EVENT_YEAR, remaining });
    }
  });

  bands.forEach((b, bi) => {
    const pts = bandSeries[bi].filter((p) => p.t > 0 && p.remaining >= 20);
    const init = bandInit[bi];
    const removedShare = bandStats.find((x) => x.label === b.label)?.removedShare ?? null;
    const hi = Number.isFinite(b.hi) ? b.hi : null;

    // 拟合要成立，需要足够的样本点，也需要这一层在观测期内真的清除过一些。
    // 清除数为 0 或个位数时，最小二乘给出的时间常数会是几千年这种
    // 数学上成立、物理上没有意义的数字——那正是「几乎不清除」的另一种说法，
    // 但把它当成一个具体年数写进页面会造成误导。这里直接判为「无法估计」。
    const decayedCount = bandStats.find((x) => x.label === b.label)?.decayed ?? 0;
    if (pts.length < 4 || decayedCount < 8) {
      bandDecay.push({
        label: b.label,
        lo: b.lo,
        hi,
        initial: init,
        alive: bands[bi].alive,
        decayed: decayedCount,
        removedShare,
        tauYears: null,
        note: '观测期内清除过少，无法估计',
      });
      return;
    }
    // 最小二乘：ln N = a + k·t，τ = -1/k
    const n = pts.length;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const p of pts) {
      const y = Math.log(p.remaining);
      sx += p.t;
      sy += y;
      sxx += p.t * p.t;
      sxy += p.t * y;
    }
    const k = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const tau = k < -1e-9 ? -1 / k : null;
    bandDecay.push({
      label: b.label,
      lo: b.lo,
      hi,
      initial: init,
      alive: bands[bi].alive,
      decayed: decayedCount,
      removedShare,
      tauYears: tau === null ? null : Math.round(tau),
      note: tau === null ? '观测期内清除过少，无法估计' : null,
    });
  });

  // 按拟合结果外推：在 +50 / +100 / +200 年时，每一层还剩多少。
  // 用于第五章的对照。上界按指数衰减，下界就是当前仍在轨的数量（不会回升）。
  const HORIZONS = [50, 100, 200];
  const projections = HORIZONS.map((h) => ({
    years: h,
    bands: bandDecay.map((d) => {
      // 无法估计时间常数的层，按「不衰减」处理——这本身就是结论：
      // 观测期内它一个都没清掉，没有任何证据支持它会在这 200 年里消失。
      const frac = d.tauYears === null ? 1 : Math.exp(-h / d.tauYears);
      const remain = Math.round(d.alive * frac);
      return {
        label: d.label,
        remaining: remain,
        share: d.initial > 0 ? +((remain / d.initial) * 100).toFixed(1) : null,
        estimated: d.tauYears !== null,
      };
    }),
  }));

  for (const p of projections) {
    p.totalRemaining = p.bands.reduce((s, b) => s + b.remaining, 0);
  }

  // ---------- 汇总：三群合并的剩余量 ----------
  const debrisSummary = {
    total: families.reduce((s, f) => s + f.total, 0),
    alive: families.reduce((s, f) => s + f.alive, 0),
    decayed: families.reduce((s, f) => s + f.decayed, 0),
  };
  debrisSummary.decayedShare = +(
    (debrisSummary.decayed / debrisSummary.total) * 100
  ).toFixed(1);
  debrisSummary.remainingShare = +(100 - debrisSummary.decayedShare).toFixed(1);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'CelesTrak SATCAT',
    sourceNote:
      '历史在轨数量由今天的编目记录倒推：对每个年份统计「发射年 ≤ 该年且（未再入或再入年 > 该年）」的记录数。' +
      '已再入且已被移出编目的对象不在其中，因此历史值略低于当年的实时编目数。',
    firstYear,
    lastYear,
    medianDelta,
    jumps,
    series,
    families,
    debrisSummary,
    bandStats,
    bandTotal,
    bandDecay,
    projections,
    bandNote:
      '分层依据为编目记录中的近地点；已再入对象的近地点是它最后一次被记录到的轨道，' +
      '因此该表回答的是「哪一层更容易被清除」，不是「碎片诞生时的高度分布」。',
    projectionNote:
      '时间常数由 2007–2026 年的实测在轨数量按指数衰减拟合得出（最小二乘），' +
      '属于拟合外推而非轨道演化仿真；其用途是给出量级差异，不是预测具体某一年。',
  };

  await mkdir(ARCHIVE, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  await writeFile(path.join(OUT, 'history.json'), json, 'utf8');
  await writeFile(path.join(ARCHIVE, 'history.json'), json, 'utf8');

  // ---------- 报告 ----------
  console.log('=== 第二章：在轨数量逐年序列 ===');
  console.log(`  年份范围      ${firstYear} – ${lastYear}`);
  console.log(`  首年在轨      ${series[0].inOrbit}`);
  console.log(`  末年在轨      ${series[series.length - 1].inOrbit}`);
  console.log(`  逐年增量中位  ${medianDelta}`);
  console.log('  跃升年份：');
  for (const j of jumps) {
    const share = j.debrisShare === null ? '-' : `${(j.debrisShare * 100).toFixed(0)}%`;
    console.log(
      `    ${j.year}  +${String(j.delta).padStart(5)} 个（其中碎片 ${share}）→ 当年在轨 ${j.inOrbit}`
    );
  }

  console.log('\n=== 第五章：三个碎片家族的衰减 ===');
  for (const f of families) {
    console.log(
      `  ${f.label.padEnd(14)} 编目 ${String(f.total).padStart(5)} | ` +
        `已再入 ${String(f.decayed).padStart(5)} (${f.decayedShare}%) | ` +
        `仍在轨 ${String(f.remaining).padStart(5)} (${f.remainingShare}%)`
    );
  }
  console.log(
    `  合计           ${debrisSummary.total} 个中已清除 ${debrisSummary.decayed} 个` +
      `（${debrisSummary.decayedShare}%），仍在轨 ${debrisSummary.alive} 个`
  );

  console.log('\n=== 第五章：按高度层的清除速度 ===');
  console.log('  层            编目  仍在轨  已清除   时间常数');
  for (const d of bandDecay) {
    const tau = d.tauYears === null ? '无法估计' : `τ ≈ ${d.tauYears} 年`;
    const share = d.removedShare === null ? '-' : `${d.removedShare}%`;
    console.log(
      `  ${d.label.padEnd(12)} ${String(d.initial).padStart(5)} ${String(d.alive).padStart(6)} ` +
        `${share.padStart(7)}   ${tau}`
    );
  }

  console.log('\n  外推（按拟合时间常数；无法估计的层按不衰减处理）：');
  for (const p of projections) {
    console.log(`    +${p.years} 年：仍在轨 ${p.totalRemaining} 个`);
    for (const b of p.bands) {
      const tag = b.estimated ? '' : '  ← 未估计';
      console.log(`        ${b.label.padEnd(12)} ${String(b.remaining).padStart(5)} 个${tag}`);
    }
  }

  console.log('\n已写入 public/data/history.json');
}

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
