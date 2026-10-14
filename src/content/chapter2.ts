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
 *   两个口径的差别在「数据与方法」里写明，不在这里悄悄换口径。
 *
 * 一条必须讲对的事：
 *   增量里占大头的是碎片，而不是发射。这一点在 1965、1982、1999 三个跃升点
 *   上尤其明显（碎片占比 89%、95%、97%）。2020 年以后反过来：
 *   总量在涨，碎片数量在减——增长重新变成发射驱动的。
 *   这条转折是本章唯一一个由数据自己给出的结论，因此单独成一步。
 */

import { int, fixed } from '../core/format';
import type { Figures } from './figures';
import type { StepCopy } from './chapter1';

export const CHAPTER_TWO_STEPS: StepCopy[] = [
  {
    id: 'growth-intro',
    nav: '增长',
    scene: 'growth-early',
    pinRatio: 1.0,
    render: (f) => `
      <div class="chapter-mark"><b>第二节</b><span>从 1 颗到 3 万颗</span></div>
      <h2>数量不是线性增长的</h2>
      <p>
        1957 年第一颗人造卫星入轨。到 1960 年底，编目里只有
        <strong>${int(yearValue(f, 1960))}</strong> 个在轨目标。
        那时把整片天空走一遍，用不了多少时间。
      </p>
      <p>
        现在是 ${int(f.cataloguedInOrbit)} 个。但这六十多年里，
        每一年新增的数量并非均匀——把它们逐年排开，
        会看到几处明显的台阶。
      </p>
      <div class="hint">
        <span><kbd>继续滚动</kbd> 时间向前推进</span>
      </div>
    `,
  },
  {
    id: 'growth-steps',
    nav: '台阶',
    scene: 'growth-payload',
    pinRatio: 1.4,
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
      <h2>先是几次碎片事件把总数顶了上去</h2>
      <p>
        把逐年增量画出来，常态大约是每年
        <strong>${int(f.medianDelta)}</strong> 个左右（这是 1957–2026 全部年份增量的中位数）。
        但有几个年份远高于这个数：
      </p>
      <div class="jumps">${rows}</div>
      <p>
        这些台阶出现的年份，对应的并不都是发射高峰。
        1965、1982、1999 这几年，新增目标的绝大多数是
        <strong>碎片</strong>而不是新发射的航天器——那是几次解体事件
        一次把成千上万个目标送上编目。
      </p>
      <div class="finding">
        <p>
          轨道环境今天的拥挤程度，不是「人类慢慢发射了六十多年」这个过程的自然结果，
          而是若干次具体事件一次性改变的结果。
        </p>
      </div>
      <p class="cite">
        <b>口径</b> 序列由 SATCAT 编目记录逐年重建：对每个年份统计「发射年 ≤ 该年，
        且未再入或再入年 > 该年」的记录数。已再入且已被移出编目的对象不在其中，
        因此历史值略低于当年的实时编目数。逐年增量的中位数为 ${int(f.medianDelta)} 个。
      </p>
    `;
    },
  },
  {
    id: 'growth-fragmentation',
    nav: '谁在增加',
    scene: 'growth-fragmentation',
    pinRatio: 1.4,
    render: (f) => {
      const recent = f.historySeries.filter((s) => s.year >= 2020);
      const recentTotal = recent.reduce((s, h) => s + h.delta, 0);
      const recentDebris = recent.reduce((s, h) => s + h.deltaDebris, 0);
      const first = f.historySeries.find((s) => s.year === 1965);
      const fy = f.debris.find((d) => d.key === 'fengyun1c');
      const c2251 = f.debris.find((d) => d.key === 'cosmos2251');
      const ir33 = f.debris.find((d) => d.key === 'iridium33');
      void first;

      return `
      <h2>四成在轨物体从来没有工作过</h2>
      <p>
        按对象类型拆开看，编目在轨的 ${int(f.cataloguedInOrbit)} 个目标里，
        碎片占 <strong>${int(debrisTypeCount(f))}</strong> 个，
        火箭残骸 <strong>${int(rocketCount(f))}</strong> 个。
        它们不是航天器，是航天器留下的东西。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">碎片与火箭残骸合计</span>
          <span class="readout-v is-warn">${int(debrisTypeCount(f) + rocketCount(f))}<small>个</small></span>
          <div class="readout-note">
            占在轨总数的
            ${fixed(((debrisTypeCount(f) + rocketCount(f)) / f.cataloguedInOrbit) * 100)}%。
            这是编目记录中的对象类型，与后文三个碎片群的根数口径不同。
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">2020 年以来净增</span>
          <span class="readout-v">+${int(recentTotal)}<small>个</small></span>
          <div class="readout-note">
            其中碎片净增 ${recentDebris >= 0 ? '+' : ''}${int(recentDebris)} 个——
            也就是说，这几年总量的增长全部来自发射，碎片反而在减少。
          </div>
        </div>
      </div>
      <p>
        这里出现了一个转折：1965 到 2000 年间，几次解体事件让碎片成为增长主体；
        而 2020 年之后，大气阻力清掉碎片的数量已经超过新增，
        总数增长重新由发射驱动——主要是低轨大规模星座。
      </p>
      <div class="finding">
        <p>
          两次增长的性质完全不同。前一次是事故的累积，
          后一次是有计划的部署。两者叠加在同一片空间里。
        </p>
      </div>
      <p class="cite">
        <b>口径</b> 对象类型取自 SATCAT 的 OBJECT_TYPE 字段（DEB / R/B / PAY）。
        与第三至五章使用的三个碎片群根数集合不是同一口径：后者只包含
        ${int(f.debrisTotal)} 个仍有公开根数、因而可定位的碎片，
        而这里统计的是编目在记录的全部碎片，含已失去跟踪的。
        两者不能相加。${fy && c2251 && ir33
          ? `本页后续章节讨论的那三群（${fy.label}、${c2251.label}、${ir33.label}）是其中根数仍在维护的子集。`
          : ''}
      </p>
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
      const y2026 = f.historySeries.find((s) => s.year === f.historyLastYear);
      const recent = f.historySeries.filter((s) => s.year >= 2020);
      const recentGain = recent.reduce((s, h) => s + h.delta, 0);
      const prev30 = f.historySeries
        .filter((s) => s.year >= 1990 && s.year <= 2019)
        .reduce((s, h) => s + h.delta, 0);
      const y2019 = f.historySeries.find((s) => s.year === 2019)?.inOrbit ?? 0;

      return `
      <h2>最近七年，增量赶上此前三十年</h2>
      <p>
        2020 年以后每年净增都在一千个以上，其中最大的一年是 2025 年，
        一年新增 <strong>${int(y2025 ? y2025.delta : 0)}</strong> 个在轨目标。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">2020–${f.historyLastYear} 净增</span>
          <span class="readout-v">+${int(recentGain)}<small>个</small></span>
          <div class="readout-note">
            七年时间。同期 1990–2019 这三十年的净增是 ${int(prev30)} 个，
            两个数几乎相等。
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">2025 年净增</span>
          <span class="readout-v">+${int(y2025 ? y2025.delta : 0)}<small>个</small></span>
        </div>
        <div class="readout">
          <span class="readout-k">${f.historyLastYear} 年净增（至历元）</span>
          <span class="readout-v">+${int(y2026 ? y2026.delta : 0)}<small>个</small></span>
          <div class="readout-note">
            这是不完整的一年：历元定在 ${f.historyLastYear} 年 10 月，
            更新一轮编目之后还会上升。
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">截至历元在轨</span>
          <span class="readout-v">${int(f.cataloguedInOrbit)}<small>个</small></span>
          <div class="readout-note">
            与 2019 年底的 ${int(y2019)} 个相比，七年增加 ${int(
              f.cataloguedInOrbit - y2019
            )} 个。
          </div>
        </div>
      </div>
      <div class="finding">
        <p>
          台阶一直在往上走，而最近这一段的坡度比之前任何一段都陡。
        </p>
      </div>
      <p class="cite">
        <b>口径</b> 净增 = 该年在轨编目数 − 上一年在轨编目数，含再入造成的减少，
        因此是净值而不是发射数量。2025 年的净增里既有大规模星座的部署，
        也扣掉了那些年份里被大气清除的旧碎片。
      </p>
    `;
    },
  },
  {
    id: 'growth-summary',
    nav: '小结',
    scene: 'growth-now',
    pinRatio: 1.0,
    // 这一步只做承接，正文里不出现数字，因此不需要 figures。
    render: () => `
      <h2>这一节留下的问题</h2>
      <p>
        增长由事件驱动，而事件留下的东西会上移——碎片被抛到比撞击点更高的轨道，
        那里几乎没有东西能把它们拉下来。接下来的三节要处理的就是这件事：
        一次具体的解体、一次具体的相撞，以及它们留下的东西会在那里待多久。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">下一节</span>
          <span class="readout-v">2007 年 1 月 11 日</span>
        </div>
      </div>
    `,
  },
];

/** 取某个年份的在轨总数，找不到时返回 0。 */
function yearValue(f: Figures, year: number): number {
  return f.historySeries.find((s) => s.year === year)?.inOrbit ?? 0;
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
 * 不直接给对象类型。因此从 altitudeDistribution 的按类型分箱里合计——
 * 那份数据按近地点分箱并逐箱给出了 PAY / R/B / DEB 三类计数。
 */
function debrisTypeCount(f: Figures): number {
  return f.altitudeTypeTotals?.DEB ?? 0;
}

function rocketCount(f: Figures): number {
  return f.altitudeTypeTotals?.['R/B'] ?? 0;
}
