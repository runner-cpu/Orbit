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
 *   4. 按这个速度外推：200 年后剩下的 8 成以上都在 750 公里以上
 *   5. 结论：这不是清洁问题，是代际问题
 *
 * 关于凯斯勒综合征：这个概念必须提，但必须只作为「机制命名」提及，
 * 不引用任何具体数值预测，也不做灾难化描述。
 */

import { int, fixed } from '../core/format';
import type { Figures } from './figures';
import type { StepCopy } from './chapter1';

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
      <h2>到现在，清掉了不到一半</h2>
      <p>
        把前三节讲过的三个碎片群放在一起看。它们在编目里一共
        <strong>${int(f.debrisAlive + f.debrisCleared)}</strong> 个，
        其中已经再入、被大气烧掉的 <strong>${int(f.debrisCleared)}</strong> 个，
        仍然在轨的 <strong>${int(f.debrisAlive)}</strong> 个。
      </p>
      <div class="legend">${rows}</div>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">三群合计已清除</span>
          <span class="readout-v">${fixed(f.debrisClearedShare)}<small>%</small></span>
          <div class="readout-note">
            这是从事件发生到现在、十几年间被大气自然清除的比例。
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">仍然在轨</span>
          <span class="readout-v is-warn">${int(f.debrisAlive)}<small>个</small></span>
        </div>
      </div>
      <p>
        三个群的清除比例差别很大：风云一号C 是
        ${fixed(familyDecayedShare(f, 'fengyun1c'))}%，
        宇宙 2251 是 ${fixed(familyDecayedShare(f, 'cosmos2251'))}%，
        铱星 33 是 ${fixed(familyDecayedShare(f, 'iridium33'))}%。
        这个差别不是随机的——它由碎片的**高度**决定。
      </p>
      <p class="cite">
        <b>口径</b> 这里的三个群取自 SATCAT 编目记录（按对象名称前缀归类），
        因此包含已再入的对象；而第三、四节的高度分布图用的是 GP 轨道根数集合，
        只含仍可定位的部分。两者不能互相加减：
        ${int(f.debrisAlive + f.debrisCleared)} 个是这一事件的全部编目产物，
        ${int(f.debrisTotal)} 个是其中位置仍可解算的部分。
      </p>
    `;
    },
  },
  {
    id: 'decay-bands',
    nav: '按层看',
    scene: 'decay-observe',
    pinRatio: 2.4,
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

      const low = f.bandFigures.find((b) => b.label.includes('400 km 以下'));
      const high = f.bandFigures.find((b) => b.label.includes('800–850'));

      return `
      <h2>清除速度不是均匀的</h2>
      <p>
        同一个碎片群里的碎片分布在不同高度上。把风云一号C 的全部
        ${int(familyTotal(f, 'fengyun1c'))} 个碎片按高度层分开，
        逐层统计「已经被清掉的比例」：
      </p>
      <div class="bands">${rows}</div>
      <p>
        从下往上看，被清掉的比例单调下降：
        ${low ? `<strong>${low.label}</strong> 已经清掉 ${fixed(low.removedShare ?? 0)}%` : ''}，
        而 <strong>${high ? high.label : '800–850 公里'}</strong>
        几乎一个都没动（${high ? fixed(high.removedShare ?? 0) : '-'}%）。
      </p>
      <div class="finding is-warn">
        <p>
          这不是「碎片正在慢慢消失」，而是「低处的碎片正在消失，
          高处的碎片基本没动静」。总清除率那不到一半的数字，
          全部来自 700 公里以下。
        </p>
      </div>
      <p class="cite">
        <b>口径与限制</b> 分层依据是编目记录中的近地点。
        已再入对象的近地点是它最后一次被记录到的轨道，不是它诞生时的轨道。
        因此这张表回答的是「哪一层更容易把东西交出来」，
        <strong>不能</strong>读成「碎片诞生时的高度分布」——
        后者要用事件当时的根数，而那批根数已经不再维护。
      </p>
    `;
    },
  },
  {
    id: 'decay-tau',
    nav: '时间常数',
    scene: 'decay-observe',
    pinRatio: 1.6,
    render: (f) => {
      const rows = f.bandFigures
        .filter((b) => b.initial >= 20)
        .map(
          (b) => `
        <div class="readout">
          <span class="readout-k">${b.label}</span>
          <span class="readout-v${b.estimated ? '' : ' is-warn'}">${
            b.tauYears === null ? '无法估计' : `${int(b.tauYears)}<small>年</small>`
          }</span>
          <div class="readout-note">
            ${
              b.estimated
                ? `观测期内清除了 ${int(b.decayed)} 个，样本足以拟合。`
                : `观测期内只清除了 ${int(b.decayed)} 个——清除太少，无法给出有意义的年数。`
            }
          </div>
        </div>`
        )
        .join('');

      return `
      <h2>把清除速度换算成时间</h2>
      <p>
        2007 年到现在，风云一号C 碎片的每一层都留下了一条「逐年还剩多少」的记录。
        对每一条曲线做指数衰减拟合，可以得到该层的时间常数：
        数量减少到原来的 1/e 所需要的年数。
      </p>
      <div class="readouts">${rows}</div>
      <p>
        从 400 公里的十年量级，到 750 公里的千年量级，相差超过两个数量级。
        而 800 公里以上连一个年数都给不出来——不是「很久」，
        而是在这十几年的观测里，它连足以拟合的清除量都没有出现过。
      </p>
      <div class="finding">
        <p>
          「大气会把它清掉」这句话在 400 公里是对的，在 800 公里不成立。
          同一套物理机制在两个高度上的效果差了三个数量级。
        </p>
      </div>
      <p class="cite">
        <b>方法</b> 时间常数由 2007–2026 年的实测在轨数量按 N(t) = N₀·e^(−t/τ)
        做最小二乘拟合得出，用的是编目记录本身，不含任何大气模型。
        清除量不足 8 个的高度层直接判为「无法估计」，
        而不是报一个数学上成立、物理上没有意义的年数。
        这是<strong>拟合外推</strong>，不是轨道演化仿真：
        它给出的是量级，不是某一年会发生什么。
      </p>
      <p class="cite">
        <b>机制</b> 这个高度依赖关系有一个公认的名字：凯斯勒综合征
        （Kessler Syndrome），由 NASA 科学家 Donald Kessler 与 Burton Cour-Palais
        在 1978 年提出。其核心判断是：当在轨物体密度足够高时，
        碰撞产生的碎片会使后续碰撞的概率上升，从而形成一个自我维持的过程。
        本作只引用这一机制本身，不复述任何具体年份的预测——
        那类预测依赖大量本作未建模的参数。
      </p>
    `;
    },
  },
  {
    id: 'decay-projection',
    nav: '往后推',
    scene: 'decay-project',
    pinRatio: 1.8,
    render: (f) => {
      const rows = f.projections
        .map((p) => {
          // 只看仍在轨的那部分在不同时刻还剩多少
          const remainShare = p.bands.reduce((s, b) => s + b.remaining, 0);
          return `
        <div class="readout">
          <span class="readout-k">再过 ${p.years} 年</span>
          <span class="readout-v">${int(remainShare)}<small>个仍在轨</small></span>
          <div class="readout-note">
            ${highBandRemain(f, p.years)}
          </div>
        </div>`;
        })
        .join('');

      const last = f.projections[f.projections.length - 1];

      return `
      <h2>按同一速度往后推</h2>
      <p>
        沿用上一步拟合出来的每一层的时间常数，把风云一号C 的
        ${int(f.debrisTotal > 0 ? familyAlive(f, 'fengyun1c') : 0)} 个仍在轨碎片往后推。
        这不是预测某一年会怎样，只是回答「差距有多大」。
      </p>
      <div class="readouts">${rows}</div>
      <div class="finding is-warn">
        <p>
          200 年之后，剩下的大部分仍然在 750 公里以上。
          低处会被清干净，高处几乎不动——
          时间并不能解决这个问题，它只把问题集中在了一个更窄的高度层里。
          ${last ? `那时仍在轨的 ${int(last.totalRemaining)} 个碎片中，有 ${highBandCount(f, last.years)} 个位于 750 公里以上。` : ''}
        </p>
      </div>
      <p class="cite">
        <b>这是外推，不是预测</b> 计算方式：每层取上一步拟合的时间常数，
        对仍在轨数量做 N(t) = N₀·e^(−t/τ)。无法估计时间常数的高度层按不衰减处理——
        这本身是结论的一部分：观测期内它一个都没清掉，
        没有任何证据支持它会在 200 年内消失。
        真实演化还会受到太阳活动周期、后续发射与碰撞的影响，均不在本作范围内。
      </p>
    `;
    },
  },
  {
    id: 'decay-close',
    nav: '收束',
    scene: 'decay-kessler',
    pinRatio: 1.2,
    // 收束步只讲机制，不引入新的读数。
    render: () => `
      <h2>这不是清洁问题，是代际问题</h2>
      <p>
        今天进入 800 公里高度的碎片，其影响的时间尺度超出了任何单一项目的
        规划周期，也超出了任何一颗在其下方运行的卫星的寿命。
        它们不会因为制造它们的那个事件被淡忘而离开。
      </p>
      <p>
        更麻烦的是机制本身的方向：这一层里每多一个碎片，
        下一次碰撞的概率就高一点；而下一次碰撞会在同一高度层
        制造出更多、更小、更难跟踪的碎片。
      </p>
      <div class="finding">
        <p>
          轨道环境不是一片可以事后打扫的场地。
          进入这一层的物体，其去留由物理常数决定，不由决定者的意愿决定。
        </p>
      </div>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">下一步</span>
          <span class="readout-v">数据与方法</span>
          <div class="readout-note">
            本页每一个数字的来源、计算方式与已知局限，都在下一节逐条列出。
          </div>
        </div>
      </div>
    `,
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

function familyTotal(f: Figures, key: string): number {
  return f.familySummary.find((x) => x.key === key)?.total ?? 0;
}

function familyAlive(f: Figures, key: string): number {
  return f.familySummary.find((x) => x.key === key)?.alive ?? 0;
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
  return `其中 ${int(high)} 个位于 750 公里以上，占剩下的 ${fixed((high / total) * 100)}%。`;
}
