/**
 * 第二章的文案与结构：数量不是线性增长的。
 *
 * 论证方式与第一章不同。第一章回答「有多少」，靠的是静态快照；
 * 这一章回答「怎么变成这么多的」，必须把时间拉进来。
 *
 * 关键数据选择：
 *   第二章用的是 SATCAT 编目的逐年重建序列，而不是可定位集合的发射年分布。
 *   原因是第二章问的是「在轨有多少」，而可定位集合只覆盖有公开根数的那部分，
 *   用它讲历史会把编目里那 19,000 余个无根数对象整段抹掉，历史增长会被低估。
 *   两个口径的差别收进「依据」折叠块，不占正文。
 *
 * 一条必须讲对的事：
 *   增量里占大头的是碎片，而不是发射。这一点在 1965、1982、1999 三个跃升点
 *   上尤其明显（碎片占比 89%、95%、97%）。2020 年以后反过来：
 *   总量在涨，碎片数量在减，增长重新变成发射驱动的。
 *   这条转折是本章唯一一个由数据自己给出的结论。
 */

import { int, fixed } from '../core/format';
import type { Figures } from './figures';
import { fold, nextCue, type StepCopy } from './chapter1';

export const CHAPTER_TWO_STEPS: StepCopy[] = [
  {
    id: 'growth-intro',
    nav: '增长',
    scene: 'growth-early',
    pinRatio: 1,
    render: (f) => `
      <div class="chapter-mark"><b>第二节</b><span>从 1 颗到 3 万颗</span></div>
      <h2>数量不是线性增长的</h2>
      <p class="lead">
        1960 年底在轨 ${int(yearValue(f, 1960))} 个，现在是
        ${int(f.cataloguedInOrbit)} 个。中间有几处台阶。
      </p>
      <div class="hint">
        <span><kbd>拖动年份轴</kbd> 看哪一年多了什么</span>
      </div>
    `,
  },
  {
    id: 'growth-steps',
    nav: '台阶',
    scene: 'growth-payload',
    pinRatio: 1.2,
    render: (f) => {
      const jumps = f.historyJumps.filter((j) => j.year <= 2010).slice(0, 6);
      const rows = jumps
        .map(
          (j) => `
        <div class="jump-row">
          <span class="jump-year mono">${j.year}</span>
          <span class="jump-track"><span class="jump-fill" style="width:${Math.min(100, (j.delta / maxJump(f)) * 100).toFixed(1)}%"></span></span>
          <span class="jump-value mono">+${int(j.delta)}</span>
        </div>`
        )
        .join('');

      return `
      <h2>几次事件把总数顶上去</h2>
      <p class="lead">
        常态每年约 ${int(f.medianDelta)} 个，但有几个年份远高于此。
      </p>
      <div class="jumps">${rows}</div>
      <div class="finding">
        <p>今天的拥挤不是慢慢积累的结果，是几次具体事件一次性改变的。</p>
      </div>
      ${fold(`
        <p>
          序列由 SATCAT 编目记录逐年重建：对每个年份统计「发射年 ≤ 该年，
          且未再入或再入年 > 该年」的记录数。已再入且已被移出编目的对象不在其中，
          因此历史值略低于当年的实时编目数。
          1965、1982、1999 这几年新增目标的绝大多数是碎片而不是新发射的航天器。
        </p>`)}
    `;
    },
  },
  {
    id: 'growth-fragmentation',
    nav: '谁在增加',
    scene: 'growth-fragmentation',
    pinRatio: 1.2,
    render: (f) => {
      const recent = f.historySeries.filter((s) => s.year >= 2020);
      const recentTotal = recent.reduce((s, h) => s + h.delta, 0);
      const recentDebris = recent.reduce((s, h) => s + h.deltaDebris, 0);

      return `
      <h2>四成在轨物体从未工作</h2>
      <p class="lead">
        编目在轨的 ${int(f.cataloguedInOrbit)} 个里，碎片
        ${int(debrisTypeCount(f))} 个、火箭残骸 ${int(rocketCount(f))} 个。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">碎片与火箭残骸合计</span>
          <span class="readout-v is-warn">${int(debrisTypeCount(f) + rocketCount(f))}<small>个</small></span>
          <div class="readout-note">
            占在轨总数的
            ${fixed(((debrisTypeCount(f) + rocketCount(f)) / f.cataloguedInOrbit) * 100)}%
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">2020 年以来净增</span>
          <span class="readout-v">+${int(recentTotal)}<small>个</small></span>
          <div class="readout-note">
            其中碎片净增 ${recentDebris >= 0 ? '+' : ''}${int(recentDebris)} 个
          </div>
        </div>
      </div>
      ${fold(`
        <p>
          对象类型取自 SATCAT 的 OBJECT_TYPE 字段（DEB / R/B / PAY）。
          与第三至五章使用的三个碎片群根数集合不是同一口径：后者只包含
          ${int(f.debrisTotal)} 个仍有公开根数、因而可定位的碎片，
          而这里统计的是编目在记录的全部碎片，含已失去跟踪的。两者不能相加。
          1965 到 2000 年间的增长由解体事件主导，2020 年之后大气阻力清掉的碎片
          已超过新增，增长重新由发射驱动。
        </p>`)}
    `;
    },
  },
  {
    id: 'growth-constellation',
    nav: '最近七年',
    scene: 'growth-constellation',
    pinRatio: 1.2,
    render: (f) => {
      const y2025 = f.historySeries.find((s) => s.year === 2025);
      const recent = f.historySeries.filter((s) => s.year >= 2020);
      const recentGain = recent.reduce((s, h) => s + h.delta, 0);
      const prev30 = f.historySeries
        .filter((s) => s.year >= 1990 && s.year <= 2019)
        .reduce((s, h) => s + h.delta, 0);

      return `
      <h2>七年赶上三十年</h2>
      <p class="lead">
        2020 年至今净增 ${int(recentGain)} 个，1990 到 2019 这三十年是
        ${int(prev30)} 个。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">2025 年净增</span>
          <span class="readout-v">+${int(y2025 ? y2025.delta : 0)}<small>个</small></span>
        </div>
        <div class="readout">
          <span class="readout-k">${f.historyLastYear} 年净增（至历元）</span>
          <span class="readout-v">+${int(yearValue2(f, f.historyLastYear))}<small>个</small></span>
        </div>
      </div>
      ${fold(`
        <p>
          净增 = 该年在轨编目数 − 上一年在轨编目数，含再入造成的减少，
          因此是净值而不是发射数量。2025 年的净增里既有大规模星座的部署，
          也扣掉了那些年份里被大气清除的旧碎片。
          最后一年不完整：历元定在 ${f.historyLastYear} 年 10 月，更新一轮编目之后还会上升。
        </p>`)}
      ${nextCue('2007 年 1 月 11 日')}
    `;
    },
  },
];

/** 取某个年份的在轨总数，找不到时返回 0。 */
function yearValue(f: Figures, year: number): number {
  return f.historySeries.find((s) => s.year === year)?.inOrbit ?? 0;
}

/** 取某个年份的净增，找不到时返回 0。 */
function yearValue2(f: Figures, year: number): number {
  return f.historySeries.find((s) => s.year === year)?.delta ?? 0;
}

/** 增量条带的归一化基准：用第一个跃升点的增量，避免个别极值把其余压扁。 */
function maxJump(f: Figures): number {
  const early = f.historyJumps.filter((j) => j.year <= 2010).slice(0, 6);
  return Math.max(1, ...early.map((j) => j.delta));
}

/**
 * 编目在轨的碎片总数。
 *
 * 这个数字只在 SATCAT 的构成统计里有，而构成统计是按「是否还在工作」切的，
 * 不直接给对象类型。因此从 altitudeDistribution 的按类型分箱里合计，
 * 那份数据按近地点分箱并逐箱给出了 PAY / R/B / DEB 三类计数。
 */
function debrisTypeCount(f: Figures): number {
  return f.altitudeTypeTotals?.DEB ?? 0;
}

function rocketCount(f: Figures): number {
  return f.altitudeTypeTotals?.['R/B'] ?? 0;
}
