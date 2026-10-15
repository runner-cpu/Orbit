/**
 * 第五章的文案与结构：它们不会自己消失。
 *
 * 这一章是全片的收束，也是唯一一章手上有实测衰减速度的地方，
 * 因此写法与前四章不同：
 *   前四章讲「发生了什么」，这一章讲「接下来会怎样」。
 *   前者有编目记录直接支撑，后者只能靠实测趋势外推，
 *   所以每一步都要写明这是外推而不是仿真。
 *
 * 论证链（每一步都能被上一节的数据接住）：
 *   1. 三个碎片群合起来 5901 个，到现在清掉了不到一半
 *   2. 但清除不是均匀的：按高度层看，400 公里以下清掉 99%，
 *      800 公里以上几乎一个没动
 *   3. 用实测序列拟合出每一层的时间常数，差距是三个数量级
 *   4. 按这个速度外推：200 年后剩下的八成以上都在 750 公里以上
 *
 * 关于凯斯勒综合征：这个概念必须提，但必须只作为「机制命名」提及，
 * 不引用任何具体数值预测，也不做灾难化描述。
 */

import { int, fixed } from '../core/format';
import type { Figures } from './figures';
import { fold, nextCue, type StepCopy } from './chapter1';
export const CHAPTER_FIVE_STEPS: StepCopy[] = [
  {
    id: 'decay-total',
    nav: '还剩多少',
    scene: 'decay-now',
    pinRatio: 1.2,
    render: (f) => {
      const rows = f.familySummary
        .map(
          (s) => `
        <div class="legend-row">
          <span class="legend-swatch" style="background:${swatchFor(s.key)}"></span>
          <span class="legend-label">${s.label}</span>
          <span class="legend-value">${int(s.remaining)}<small> / ${int(s.total)}</small></span>
        </div>`
        )
        .join('');

      return `
      <div class="chapter-mark"><b>第五节</b><span>它们不会自己消失</span></div>
      <h2>清掉了不到一半</h2>
      <p class="lead">
        三个碎片群合计 ${int(f.debrisAlive + f.debrisCleared)} 个，
        已清除 ${fixed(f.debrisClearedShare)}%，仍在轨 ${int(f.debrisAlive)} 个。
      </p>
      <div class="legend">${rows}</div>
      ${fold(`
        <p>
          这里的三个群取自 SATCAT 编目记录（按对象名称前缀归类），因此包含已再入的对象；
          而第三、四节的高度分布图用的是 GP 轨道根数集合，只含仍可定位的部分。
          两者不能互相加减：${int(f.debrisAlive + f.debrisCleared)} 个是这三个事件的全部编目产物，
          ${int(f.debrisTotal)} 个是其中位置仍可解算的部分。
          三个群的清除比例差别很大（风云一号C ${fixed(familyDecayedShare(f, 'fengyun1c'))}%、
          宇宙 2251 ${fixed(familyDecayedShare(f, 'cosmos2251'))}%、
          铱星 33 ${fixed(familyDecayedShare(f, 'iridium33'))}%），
          这个差别不是随机的，它由碎片所在的高度决定。
        </p>`)}
    `;
    },
  },
  {
    id: 'decay-bands',
    nav: '按层看',
    scene: 'decay-observe',
    pinRatio: 1.6,
    render: (f) => {
      const rows = f.bandFigures
        .map((b) => {
          const share = b.removedShare ?? 0;
          // 用填充长度表达「这一层被清掉的比例」。读者一眼能看出
          // 从下到上是一条单调下降的曲线，这比列数字更直接。
          const hot = share < 10;
          return `
          <div class="band-row${hot ? ' is-hot' : ''}">
            <span class="band-label mono">${b.label}</span>
            <span class="band-track"><span class="band-fill" style="width:${Math.max(0.6, share).toFixed(1)}%"></span></span>
            <span class="band-value mono">${fixed(share)}%</span>
          </div>`;
        })
        .join('');

      return `
      <h2>清除速度不是均匀的</h2>
      <p class="lead">
        按高度层看被清掉的比例，从下往上单调下降，到 800 公里以上几乎为零。
      </p>
      <div class="bands">${rows}</div>
      <div class="finding is-warn">
        <p>低处的在消失，高处的基本没动静。</p>
      </div>
      ${fold(`
        <p>
          分层依据是编目记录中的近地点。已再入对象的近地点是它最后一次被记录到的轨道，
          不是它诞生时的轨道。因此这张表回答的是「哪一层更容易把东西交出来」，
          不能读成「碎片诞生时的高度分布」，后者要用事件当时的根数，
          而那批根数已经不再维护。
        </p>`)}
    `;
    },
  },
  {
    id: 'decay-tau',
    nav: '时间常数',
    scene: 'decay-observe',
    pinRatio: 1.2,
    render: (f) => {
      // 只有「无法估计」的两层带注释。
      //
      // 有年数的层不需要再写一句「样本足以拟合」：年数本身就是结论，
      // 八行各配一句会让右栏比一屏还高。反过来，年数给不出来的两层
      // 必须给出理由，否则读者会以为是我方没算。
      const rows = f.bandFigures
        .filter((b) => b.initial >= 20)
        .map(
          (b) => `
        <div class="readout">
          <span class="readout-k">${b.label}</span>
          <span class="readout-v${b.estimated ? '' : ' is-warn'}">${
            b.tauYears === null ? '无法估计' : `${int(b.tauYears)}<small>年</small>`
          }</span>
          ${b.estimated ? '' : `<div class="readout-note">观测期内只清除了 ${int(b.decayed)} 个</div>`}
        </div>`
        )
        .join('');

      return `
      <h2>把清除速度换算成时间</h2>
      <p class="lead">
        每层的时间常数从十年量级到千年量级，相差超过两个数量级。
      </p>
      <div class="readouts">${rows}</div>
      <div class="finding">
        <p>
          「大气会把它清掉」在 400 公里是对的，在 800 公里不成立。
        </p>
      </div>
      ${fold(`
        <p>
          时间常数由 2007 至 ${f.historyLastYear} 年的实测在轨数量按
          N(t) = N₀·e^(−t/τ) 做最小二乘拟合得出，用的是编目记录本身，
          不含任何大气模型。清除量不足 8 个的高度层直接判为「无法估计」，
          而不是报一个数学上成立、物理上没有意义的年数。
          这是拟合外推，不是轨道演化仿真：它给出的是量级，不是某一年会发生什么。
          800 公里以上连一个年数都给不出来，不是「很久」，
          而是在这十几年的观测里，它连足以拟合的清除量都没有出现过。
        </p>`)}
    `;
    },
  },
  {
    id: 'decay-projection',
    nav: '往后推',
    scene: 'decay-project',
    pinRatio: 1.4,
    render: (f) => {
      const rows = f.projections
        .map(
          (p) => `
        <div class="readout">
          <span class="readout-k">再过 ${p.years} 年</span>
          <span class="readout-v">${int(p.bands.reduce((s, b) => s + b.remaining, 0))}<small>个仍在轨</small></span>
          <div class="readout-note">${highBandRemain(f, p.years)}</div>
        </div>`
        )
        .join('');

      const last = f.projections[f.projections.length - 1];

      return `
      <h2>按同一速度往后推</h2>
      <p class="lead">
        沿用上一步的时间常数，把风云一号C 仍在轨的碎片往后推。
      </p>
      <div class="readouts">${rows}</div>
      <div class="finding is-warn">
        <p>200 年后剩下的仍大部分在 750 公里以上：时间只把问题压进更窄的一层。</p>
      </div>
      ${fold(`
        <p>
          计算方式：每层取上一步拟合的时间常数，对仍在轨数量做 N(t) = N₀·e^(−t/τ)。
          无法估计时间常数的高度层按不衰减处理，这本身是结论的一部分：
          观测期内它一个都没清掉，没有任何证据支持它会在 200 年内消失。
          真实演化还会受到太阳活动周期、后续发射与碰撞的影响，均不在本作范围内。
          ${
            last
              ? `第 ${last.years} 年仍在轨的 ${int(last.totalRemaining)} 个碎片中，有 ${highBandCount(
                  f,
                  last.years
                )} 个位于 750 公里以上。`
              : ''
          }
          这个高度依赖关系有一个公认的名字：凯斯勒综合征，由 NASA 科学家
          Donald Kessler 与 Burton Cour-Palais 在 1978 年提出。其核心判断是：
          当在轨物体密度足够高时，碰撞产生的碎片会使后续碰撞的概率上升，
          从而形成一个自我维持的过程。本作只引用这一机制本身，
          不复述任何具体年份的预测，那类预测依赖大量本作未建模的参数。
        </p>`, '依据与机制')}
      ${nextCue('数据与方法')}
    `;
    },
  },
];

/** 图例色，与 scenes.ts 的 DEBRIS_PALETTE 对应。 */
function swatchFor(key: string): string {
  switch (key) {
    case 'fengyun1c':
      return '#ff7a45';
    case 'cosmos2251':
      return '#4fc3f7';
    case 'iridium33':
      return '#ffd54f';
    default:
      return '#5a6b78';
  }
}

function familyDecayedShare(f: Figures, key: string): number {
  return f.familySummary.find((x) => x.key === key)?.decayedShare ?? 0;
}

/** 某个外推时刻，750 公里以上的剩余数量。 */
function highBandCount(f: Figures, years: number): number {
  const p = f.projections.find((x) => x.years === years);
  if (!p) return 0;
  return p.bands
    .filter((b) => /7[5-9]0|8[0-9]0|900/.test(b.label))
    .reduce((s, b) => s + b.remaining, 0);
}

/** 一行说明：到该时刻，剩下的里面有多少在高处。 */
function highBandRemain(f: Figures, years: number): string {
  const p = f.projections.find((x) => x.years === years);
  if (!p) return '';
  const high = highBandCount(f, years);
  const total = p.bands.reduce((s, b) => s + b.remaining, 0);
  if (total === 0) return '全部清空。';
  return `其中 ${int(high)} 个位于 750 公里以上，占剩下的 ${fixed((high / total) * 100)}%`;
}
