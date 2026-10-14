/**
 * 作品的数字来源集中在这里。
 *
 * 为什么单独成文件：页面上每个数字都必须能被追溯到一份数据文件或一段脚本输出。
 * 把数字散写在渲染代码里，改一处数据就要全页搜索；集中之后，任何数字的来源
 * 只有一处，文案与场景都从这里取，页面不会出现「同一量两个值」的情况。
 *
 * 全部数值均来自 data/ 与 public/data/ 下由脚本生成的产物，未手工填写。
 */

import type { LoadedData, PopulationStats } from '../core/data';

/** 三个碎片群的统计，来自 public/data/debris-meta.json 生成时的同源计算。 */
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
  bands: { label: string; count: number; share: number }[];
  /** 发射年份累计序列，用于说明增长不是线性的 */
  launchCumulative: { year: number; count: number; cumulative: number }[];
  /** 可定位集合中 2020 年及以后发射的占比 */
  recentShare: number;
  /** 在轨构成，按「是否还能工作」切分 */
  breakdown: PopulationStats['breakdown'];
  /** 碎片群 */
  debris: DebrisGroupFigures[];
  /** 碎片合计 */
  debrisTotal: number;
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
  // 400–600 km 是当前的载人航天与主力星座高度，600 km 以上大气阻力开始
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
      count: bandCounts[i],
      share: (bandCounts[i] / n) * 100,
    })),
    launchCumulative,
    recentShare: (recent / n) * 100,
  };
}

export function buildFigures(data: LoadedData, debris: DebrisGroupFigures[]): Figures {
  const p = data.population;
  const stats = analyzeCatalog(data);

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
    debris,
    debrisTotal: debris.reduce((s, d) => s + d.count, 0),
  };
}

export { R_EARTH };
