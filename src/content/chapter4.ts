/**
 * 第四章的文案与结构：2009 年 2 月 10 日，宇宙 2251 与铱星 33 相撞。
 *
 * 这一章与第三章构成对照：
 *   第三章是「主动打了一颗」，第四章是「两颗自己撞上了」。
 *   前者是决定的结果，后者是概率的兑现，但后果的形态是同一类。
 *
 * 解释力度都压在一件事上：两个碎片群的轨道倾角差。
 *   宇宙 2251：73.5–74.3°
 *   铱星 33：86.0–86.5°
 * 相差约 12°，这不是巧合，是两条原轨道面的朝向差。
 * 两个大角度交叉的轨道面，相遇时相对速度可达每秒十几公里量级——
 * 这是碎片数量如此之多的直接原因，也是这一章唯一需要记住的数字关系。
 */

import { int, fixed } from '../core/format';
import type { StepCopy } from './chapter1';

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
      <p>
        那一天，一颗已经失效的俄罗斯通信卫星（宇宙 2251）与一颗仍在工作的
        美国通信卫星（铱星 33）在西伯利亚上空约 790 公里的高度相撞。
        这是有记录以来第一次两颗完整航天器之间的意外超高速碰撞。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">宇宙 2251 碎片</span>
          <span class="readout-v mono-value" style="color:#4fc3f7">${int(c.count)}<small>个</small></span>
          <div class="readout-note">
            编目里属于该事件、且仍有公开轨道根数的碎片。
            近地点中位数 ${fixed(c.perigeeMedianKm)} 公里。
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">铱星 33 碎片</span>
          <span class="readout-v mono-value" style="color:#ffd54f">${int(i.count)}<small>个</small></span>
          <div class="readout-note">
            近地点中位数 ${fixed(i.perigeeMedianKm)} 公里。
            两个群产生在同一次事件、高度接近，但数量相差
            ${fixed(c.count / i.count, 1)} 倍。
          </div>
        </div>
      </div>
      <p class="cite">
        <b>口径</b> 两个群来自 CelesTrak 的两份独立碎片根数表，
        按 NORAD 编号与在轨编目去重后无重叠。
        数量差异主要来自两颗卫星的构型与尺寸不同，
        以及碰撞时的几何关系，本作不对具体成因作推断。
      </p>
    `;
    },
  },
  {
    id: 'impact-planes',
    nav: '两个面',
    scene: 'impact-plane',
    pinRatio: 1.5,
    render: (f) => {
      const c = f.debris.find((d) => d.key === 'cosmos2251');
      const i = f.debris.find((d) => d.key === 'iridium33');
      if (!c || !i) return '';
      const diff = fixed(Math.abs(i.inclMedianDeg - c.inclMedianDeg));
      return `
      <h2>它们本来在不同的轨道面上</h2>
      <p>
        把两个碎片群按轨道倾角分开看：宇宙 2251 的碎片集中在
        <strong>${fixed(c.inclMinDeg)}–${fixed(c.inclMaxDeg)}°</strong>，
        铱星 33 的碎片集中在
        <strong>${fixed(i.inclMinDeg)}–${fixed(i.inclMaxDeg)}°</strong>。
        两个区间几乎不重叠，中位数相差约 <strong>${diff}°</strong>。
      </p>
      <p>
        轨道倾角是轨道面与赤道面的夹角。倾角不同，就意味着两条轨道面
        以一定角度交叉——它们必然有交线，也就必然存在两个可能相撞的位置。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">宇宙 2251 倾角中位数</span>
          <span class="readout-v mono-value" style="color:#4fc3f7">${fixed(c.inclMedianDeg)}<small>°</small></span>
        </div>
        <div class="readout">
          <span class="readout-k">铱星 33 倾角中位数</span>
          <span class="readout-v mono-value" style="color:#ffd54f">${fixed(i.inclMedianDeg)}<small>°</small></span>
        </div>
        <div class="readout">
          <span class="readout-k">轨道面夹角</span>
          <span class="readout-v">约 ${diff}<small>°</small></span>
          <div class="readout-note">
            这是两条原始轨道面的夹角。倾角区间几乎不重叠，
            说明两个群确实来自两个方向不同的轨道面，
            而不是同一批碎片在扩散。
          </div>
        </div>
      </div>
      <div class="finding">
        <p>
          相撞不是「两件东西碰巧挨得近」，而是两条大角度交叉的轨道
          在交线上的一处时间重合。只要两个面一直存在，
          交线就一直存在。
        </p>
      </div>
      <p class="cite">
        <b>方法</b> 倾角取自 GP 轨道根数的第二行第 9–16 字符，
        逐点统计后给出区间与中位数。
        画面中的着色按所属碎片群区分，与前一张图不同：
        这里要看的不是高度分布，而是两个群的轨道面朝向。
      </p>
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
      <p>
        低地球轨道上的物体都以约每秒 7.5 公里的速度运行。
        两个轨道面夹角越大，相遇时的相对速度就越高：
        同向几乎并行时相对速度很小，大角度交叉时可达每秒十几公里量级。
      </p>
      <p>
        这次撞击的相对速度约每秒十几公里——是步枪子弹速度的十几倍。
        在这样的能量密度下，两颗卫星都被彻底解体。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">两个群合计（可定位）</span>
          <span class="readout-v is-warn">${int(total)}<small>个</small></span>
          <div class="readout-note">
            这一次事件就让近地轨道的可定位对象增加了
            ${fixed((total / f.located) * 100, 1)}%。
          </div>
        </div>
      </div>
      <div class="finding is-warn">
        <p>
          第三章与本章是两种不同性质的解体：一次是有意的拦截，
          一次是无意的相撞。它们产生碎片的物理机制相同，
          后果的形态也相同——都被抛进一个会长期保持的高度层。
        </p>
      </div>
      <p class="cite">
        <b>说明</b> 本页不引用任何外部报道中的速度数值作为本作的计算结果，
        只用轨道根数能直接支撑的结论：两个群的轨道面夹角约
        ${fixed(Math.abs(i.inclMedianDeg - c.inclMedianDeg))}°，
        因此相遇时的相对速度必然远高于同向接近的情形。
        具体的相对速度取决于相遇时刻的位置，本作不做该解算。
      </p>
    `;
    },
  },
  {
    id: 'impact-verdict',
    nav: '小结',
    scene: 'impact-dual',
    pinRatio: 1.1,
    render: (f) => {
      const c = f.debris.find((d) => d.key === 'cosmos2251');
      const i = f.debris.find((d) => d.key === 'iridium33');
      if (!c || !i) return '';
      return `
      <h2>这一节要留下的</h2>
      <p>
        一次意外的相撞，在编目里留下 ${int(c.count + i.count)} 个仍可定位的碎片，
        分布在两个朝向不同的轨道面上。
        它们中的绝大多数位于 700 公里附近及以上——按第三节的机制，
        这个高度上的清除速度很慢。
      </p>
      <p>
        至此，三节下来已经出现过三个具体的碎片群。下一节把它们叠在一起，
        并且回答最后一个问题：这些东西会在那里留多久。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">下一节</span>
          <span class="readout-v">它们不会自己消失</span>
        </div>
      </div>
    `;
    },
  },
];
