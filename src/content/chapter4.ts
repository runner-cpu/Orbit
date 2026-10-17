/**
 * 第四章的文案与结构：2009 年 2 月 10 日，宇宙 2251 与铱星 33 相撞。
 *
 * 这一章与第三章构成对照：
 *   第三章是「主动打了一颗」，第四章是「两颗自己撞上了」。
 *   前者是决定的结果，后者是概率的兑现，但后果的形态是同一类。
 *
 * 解释力度都压在一件事上：两个碎片群的轨道倾角差。
 *   宇宙 2251：73.5 至 74.3 度
 *   铱星 33：86.0 至 86.5 度
 * 相差约 12 度，这不是巧合，是两条原轨道面的朝向差。
 * 两个大角度交叉的轨道面，相遇时相对速度可达每秒十几公里量级，
 * 这是碎片数量如此之多的直接原因，也是这一章唯一需要记住的数字关系。
 */

import { int, fixed } from '../core/format';
import { fold, nextCue, type StepCopy } from './chapter1';

export const CHAPTER_FOUR_STEPS: StepCopy[] = [
  {
    id: 'impact-arrive',
    nav: '一次意外',
    scene: 'impact-dual',
    pinRatio: 1.2,
    render: (f) => {
      const c = f.debris.find((d) => d.key === 'cosmos2251');
      const i = f.debris.find((d) => d.key === 'iridium33');
      if (!c || !i) return '';
      return `
      <div class="chapter-mark"><b>第四节</b><span>2009 年 2 月 10 日</span></div>
      <h2>一次意外相撞</h2>
      <p class="lead">
        已经失效的宇宙 2251 与仍在工作的铱星 33，在 790 公里高处撞上了。
      </p>
      <div class="readouts">
        <div class="readout" style="--frac:1; --bar:rgba(79,195,247,.7)">
          <span class="readout-k">宇宙 2251 碎片</span>
          <span class="readout-v mono-value" style="color:#4fc3f7">${int(c.count)}<small>个</small></span>
          <div class="readout-note">近地点中位数 ${fixed(c.perigeeMedianKm)} 公里</div>
        </div>
        <div class="readout" style="--frac:${(i.count / c.count).toFixed(3)}; --bar:rgba(255,213,79,.7)">
          <span class="readout-k">铱星 33 碎片</span>
          <span class="readout-v mono-value" style="color:#ffd54f">${int(i.count)}<small>个</small></span>
          <div class="readout-note">
            近地点中位数 ${fixed(i.perigeeMedianKm)} 公里。两个群产生在同一次事件、
            高度接近，数量相差 ${fixed(c.count / i.count, 1)} 倍
          </div>
        </div>
      </div>
      ${fold(`
        <p>
          两个群来自 CelesTrak 的两份独立碎片根数表，按 NORAD 编号与在轨编目去重后无重叠。
          数量差异主要来自两颗卫星的构型与尺寸不同，以及碰撞时的几何关系，
          本作不对具体成因作推断。
        </p>`)}
    `;
    },
  },
  {
    id: 'impact-planes',
    nav: '两个面',
    scene: 'impact-plane',
    pinRatio: 1.3,
    render: (f) => {
      const c = f.debris.find((d) => d.key === 'cosmos2251');
      const i = f.debris.find((d) => d.key === 'iridium33');
      if (!c || !i) return '';
      const diff = fixed(Math.abs(i.inclMedianDeg - c.inclMedianDeg));
      return `
      <h2>它们本在不同的轨道面上</h2>
      <p class="lead">
        两个群一个偏 74 度，一个偏 86 度。差的这 ${diff} 度，就是那次相撞的全部原因。
      </p>
      <div class="readouts">
        <div class="readout" style="--frac:${(c.inclMedianDeg / 90).toFixed(3)}">
          <span class="readout-k">宇宙 2251 倾角中位数</span>
          <span class="readout-v mono-value" style="color:#4fc3f7">${fixed(c.inclMedianDeg)}<small>°</small></span>
        </div>
        <div class="readout" style="--frac:${(i.inclMedianDeg / 90).toFixed(3)}">
          <span class="readout-k">铱星 33 倾角中位数</span>
          <span class="readout-v mono-value" style="color:#ffd54f">${fixed(i.inclMedianDeg)}<small>°</small></span>
        </div>
      </div>
      <div class="finding">
        <p>相撞是两条交叉轨道在交线上的一处时间重合。</p>
      </div>
      <p class="try">拖动右栏的转盘，两条轨道面会跟着转；差的这 ${diff} 度就是全部原因。</p>
      ${fold(`
        <p>
          倾角取自 GP 轨道根数，逐点统计后给出区间与中位数。
          宇宙 2251 的碎片集中在 ${fixed(c.inclMinDeg)} 至 ${fixed(c.inclMaxDeg)} 度，
          铱星 33 的碎片集中在 ${fixed(i.inclMinDeg)} 至 ${fixed(i.inclMaxDeg)} 度。
          两个区间几乎不重叠，说明两个群确实来自两个方向不同的轨道面，
          而不是同一批碎片在扩散。倾角不同就意味着两条轨道面以一定角度交叉，
          它们必然有交线，也就必然存在两个可能相撞的位置。
        </p>`)}
    `;
    },
  },
  {
    id: 'impact-speed',
    nav: '为什么这么多',
    scene: 'impact-plane',
    pinRatio: 1.3,
    render: (f) => {
      const c = f.debris.find((d) => d.key === 'cosmos2251');
      const i = f.debris.find((d) => d.key === 'iridium33');
      if (!c || !i) return '';
      const total = c.count + i.count;
      return `
      <h2>相对速度决定碎片数量</h2>
      <p class="lead">
        两个群合计 ${int(total)} 个。轨道面交叉得这么陡，撞击时是每秒十几公里的相对速度。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">两个群合计（可定位）</span>
          <span class="readout-v is-warn">${int(total)}<small>个</small></span>
          <div class="readout-note">
            占球上全部可定位对象的 ${fixed((total / f.located) * 100, 1)}%
          </div>
        </div>
      </div>
      <div class="finding is-warn">
        <p>两次解体性质不同，后果的形态相同：都被抛进一个长期保持的高度层。</p>
      </div>
      ${fold(`
        <p>
          低地球轨道上的物体都以约每秒 7.5 公里的速度运行。两个轨道面夹角越大，
          相遇时的相对速度就越高：同向几乎并行时相对速度很小，大角度交叉时
          可达每秒十几公里量级。本页不引用任何外部报道中的速度数值作为本作的计算结果，
          只用轨道根数能直接支撑的结论：两个群的轨道面夹角约
          ${fixed(Math.abs(i.inclMedianDeg - c.inclMedianDeg))} 度，
          因此相遇时的相对速度必然远高于同向接近的情形。
          具体的相对速度取决于相遇时刻的位置，本作不做该解算。
        </p>`)}
      ${nextCue('它们不会自己消失')}
    `;
    },
  },
];
