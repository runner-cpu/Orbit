/**
 * 作品的数字来源集中在这里。
 *
 * 为什么单独成文件：页面上每个数字都必须能被追溯到一份数据文件或一段脚本输出。
 * 把数字散写在渲染代码里，改一处数据就要全页搜索；集中之后，任何数字的来源
 * 只有一处，文案与场景都从这里取，页面不会出现「同一量两个值」的情况。
 *
 * 全部数值均来自 data/ 与 public/data/ 下由脚本生成的产物，未手工填写。
 */

import type { LoadedData, PopulationStats, HistoryData, DebrisData } from '../core/data';

/** 三个碎片群的统计。前六项来自 debris-meta.json，后两项在运行期从点云现场统计。 */
export interface DebrisGroupFigures {
  key: string;
  label: string;
  event: string;
  color: string;
  count: number;
  perigeeMedianKm: number;
  perigeeMinKm: number;
  perigeeMaxKm: number;
  above800km: number;
  inclMinDeg: number;
  inclMedianDeg: number;
  inclMaxDeg: number;
  /** 近地点分箱，50 km 一档，供第三章的高度分布图使用 */
  perigeeBins?: { lo: number; hi: number; count: number }[];
}

/** 高度层与清除速度。第五章的核心读数。 */
export interface BandFigure {
  label: string;
  initial: number;
  alive: number;
  decayed: number;
  removedShare: number | null;
  tauYears: number | null;
  estimated: boolean;
}

export interface Figures {
  /** 编目在轨总数（含无公开轨道根数的对象） */
  cataloguedInOrbit: number;
  /** 历史累计编目数（含已陨落） */
  cataloguedAllTime: number;
  /** 可获取公开轨道根数、因而能被逐一定位的对象数 */
  located: number;
  /** 编目中仍在工作、且可定位的载荷 */
  locatedWorking: number;
  /** 编目中仍在工作的载荷总数 */
  workingPayloads: number;
  /** 在轨物体中不在正常工作状态的比例（%） */
  notWorkingShare: number;
  /** 编目在轨但无公开轨道根数的对象数 */
  notLocatable: number;
  /** 可定位集合中处于近地轨道（<2000 km）的数量与占比 */
  leo: { count: number; share: number };
  /** 可定位集合中的高度分层，用于阐述「挤在同一层」 */
  bands: { label: string; lo: number; hi: number; count: number; share: number }[];
  /** 发射年份累计序列（可定位集合），作为第二章的对照口径 */
  launchCumulative: { year: number; count: number; cumulative: number }[];
  /** 可定位集合中 2020 年及以后发射的占比 */
  recentShare: number;
  /** 在轨构成，按「是否还能工作」切分 */
  breakdown: PopulationStats['breakdown'];
  /** 碎片群 */
  debris: DebrisGroupFigures[];
  /** 碎片合计 */
  debrisTotal: number;

  // ---------- 第二章：历史序列（来自 history.json） ----------
  /** 逐年在轨编目总量，1957 年起 */
  historySeries: HistoryData['series'];
  /** 增量显著高于常态的年份 */
  historyJumps: HistoryData['jumps'];
  /** 逐年增量中位数，作为「常态增长」的基准线 */
  medianDelta: number;
  /** 首年与末年 */
  historyFirstYear: number;
  historyLastYear: number;

  // ---------- 第五章：衰减 ----------
  /** 按高度层的清除速度 */
  bandFigures: BandFigure[];
  /** 50 / 100 / 200 年后的剩余量 */
  projections: HistoryData['projections'];
  /** 三个碎片家族的清除比例 */
  familySummary: HistoryData['families'];
  /** 三群合计：仍在轨 / 已清除 */
  debrisAlive: number;
  debrisCleared: number;
  debrisClearedShare: number;

  /**
   * 编目在轨对象按类型合计（PAY / R/B / DEB）。
   *
   * 为什么单独算：第二章要引用「在轨物体里碎片有多少个」，
   * 而这个数只有 SATCAT 的构成统计里才有，且那份数据是按高度分箱给的。
   * 在这里一次合计好，避免每个文案模块各算一遍导致口径漂移。
   */
  altitudeTypeTotals: Record<string, number>;
}

const R_EARTH = 6378.137;

/** 从 catalog.bin 现场统计，保证页面数字与数据文件一致。 */
function analyzeCatalog(data: LoadedData): Pick<
  Figures,
  'located' | 'locatedWorking' | 'leo' | 'bands' | 'launchCumulative' | 'recentShare'
> {
  const { catalog, catalogMeta, offset, gap } = data;
  const stride = catalogMeta.stride;
  const n = catalogMeta.count;

  let leo = 0;
  let recent = 0;
  const yearCount = new Map<number, number>();

  // 分层边界按 LEO 内部的物理分界选取，而不是等距分箱：
  // 400 至 600 km 是当前的载人航天与主力星座高度，600 km 以上大气阻力开始
  // 显著减弱，800 km 以上几乎不再起清除作用。分箱要能读出这些差别。
  const bandDefs: { label: string; lo: number; hi: number }[] = [
    { label: '200-400 km', lo: 200, hi: 400 },
    { label: '400-600 km', lo: 400, hi: 600 },
    { label: '600-800 km', lo: 600, hi: 800 },
    { label: '800-2000 km', lo: 800, hi: 2000 },
    { label: '2000-30000 km', lo: 2000, hi: 30000 },
    { label: '30000-40000 km', lo: 30000, hi: 40000 },
  ];
  const bandCounts = bandDefs.map(() => 0);

  for (let i = 0; i < n; i += 1) {
    const o = i * stride;
    const perigee = catalog[o + offset.perigeeKm];
    const year = catalog[o + offset.launchYear];
    const category = catalog[o + offset.category];

    if (Number.isFinite(perigee)) {
      if (perigee < 2000) leo += 1;
      const bi = bandDefs.findIndex((b) => perigee >= b.lo && perigee < b.hi);
      if (bi >= 0) bandCounts[bi] += 1;
    }
    if (year > 0) {
      yearCount.set(year, (yearCount.get(year) ?? 0) + 1);
      if (year >= 2020) recent += 1;
    }
    void category;
  }

  const years = [...yearCount.keys()].sort((a, b) => a - b);
  let running = 0;
  const launchCumulative = years.map((year) => {
    running += yearCount.get(year) ?? 0;
    return { year, count: yearCount.get(year) ?? 0, cumulative: running };
  });

  return {
    located: n,
    locatedWorking: gap.workingRenderable,
    leo: { count: leo, share: (leo / n) * 100 },
    bands: bandDefs.map((b, i) => ({
      label: b.label,
      lo: b.lo,
      hi: b.hi,
      count: bandCounts[i],
      share: (bandCounts[i] / n) * 100,
    })),
    launchCumulative,
    recentShare: (recent / n) * 100,
  };
}

/**
 * 从碎片点云现场统计每个群的近地点分布与倾角范围。
 *
 * 为什么在这里再算一遍，而不是直接用 debris-meta.json 里已有的中位数：
 *   元信息里的数字是构建期算的，用来核对（见 scripts/verify-data.mjs）。
 *   页面上的分箱图需要的是完整分布，元信息里没有。
 *   两处的结果必须一致，不一致时核对脚本会报错。
 */
function analyzeDebris(
  debris: DebrisData
): { key: string; bins: { lo: number; hi: number; count: number }[]; inclMin: number; inclMedian: number; inclMax: number }[] {
  const { points, meta, offset } = debris;
  const stride = meta.stride;
  const n = meta.total;
  const groupCount = meta.groupKeys.length;

  const bins = Array.from({ length: groupCount }, () => new Map<number, number>());
  const incls = Array.from({ length: groupCount }, () => [] as number[]);

  for (let i = 0; i < n; i += 1) {
    const o = i * stride;
    const g = Math.round(points[o + offset.groupId]);
    if (g < 0 || g >= groupCount) continue;
    const pg = points[o + offset.perigeeKm];
    if (Number.isFinite(pg)) {
      const lo = Math.floor(pg / 50) * 50;
      bins[g].set(lo, (bins[g].get(lo) ?? 0) + 1);
    }
    const ic = points[o + offset.inclDeg];
    if (Number.isFinite(ic)) incls[g].push(ic);
  }

  return meta.groupKeys.map((key, g) => {
    const list = [...bins[g].entries()].sort((a, b) => a[0] - b[0]);
    const sorted = incls[g].sort((a, b) => a - b);
    return {
      key,
      bins: list.map(([lo, count]) => ({ lo, hi: lo + 50, count })),
      inclMin: +sorted[0].toFixed(1),
      inclMedian: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
      inclMax: +sorted[sorted.length - 1].toFixed(1),
    };
  });
}

export function buildFigures(
  data: LoadedData,
  debrisGroups: DebrisGroupFigures[],
  debris: DebrisData,
  history: HistoryData
): Figures {
  const p = data.population;
  const stats = analyzeCatalog(data);
  const debrisStats = analyzeDebris(debris);

  const merged = debrisGroups.map((g) => {
    const s = debrisStats.find((d) => d.key === g.key);
    return {
      ...g,
      inclMinDeg: s?.inclMin ?? g.inclMinDeg,
      inclMedianDeg: s?.inclMedian ?? g.inclMedianDeg,
      inclMaxDeg: s?.inclMax ?? g.inclMaxDeg,
      perigeeBins: s?.bins ?? [],
    };
  });

  const bandFigures: BandFigure[] = history.bandDecay
    .filter((b) => b.decayed + b.alive > 0)
    .map((b) => ({
      label: b.label,
      initial: b.initial,
      alive: b.alive,
      decayed: b.decayed,
      removedShare: b.removedShare ?? null,
      tauYears: b.tauYears,
      estimated: b.tauYears !== null,
    }));

  // 编目在轨对象按类型合计。altitudeDistribution 按近地点分箱并逐箱给出三类计数，
  // 这里把它们加总。第二章引用「在轨物体里碎片有多少个」时用它。
  const altitudeTypeTotals: Record<string, number> = { PAY: 0, 'R/B': 0, DEB: 0, UNK: 0 };
  for (const b of p.altitudeDistribution.bands) {
    altitudeTypeTotals.PAY += b.PAY ?? 0;
    altitudeTypeTotals['R/B'] += b['R/B'] ?? 0;
    altitudeTypeTotals.DEB += b.DEB ?? 0;
    altitudeTypeTotals.UNK += b.UNK ?? 0;
  }

  return {
    cataloguedInOrbit: p.inOrbit,
    cataloguedAllTime: p.totalCatalogued,
    located: stats.located,
    locatedWorking: stats.locatedWorking,
    workingPayloads: p.workingPayloads,
    notWorkingShare: p.nonWorkingShare,
    notLocatable: data.gap.unrenderable,
    leo: stats.leo,
    bands: stats.bands,
    launchCumulative: stats.launchCumulative,
    recentShare: stats.recentShare,
    breakdown: p.breakdown,
    debris: merged,
    debrisTotal: merged.reduce((s, d) => s + d.count, 0),

    historySeries: history.series,
    historyJumps: history.jumps,
    medianDelta: history.medianDelta,
    historyFirstYear: history.firstYear,
    historyLastYear: history.lastYear,

    bandFigures,
    projections: history.projections,
    familySummary: history.families,
    debrisAlive: history.debrisSummary.alive,
    debrisCleared: history.debrisSummary.decayed,
    debrisClearedShare: history.debrisSummary.decayedShare,
    altitudeTypeTotals,
  };
}

export { R_EARTH };
