/**
 * 第三章的文案与结构：2007 年 1 月 11 日，风云一号C 解体。
 *
 * 这一章是全片最核心的科学论点所在，因此文案上最需要克制：
 *   结论必须由高度分布图自己得出，而不是先给结论再配图。
 *   页面顺序是「看形态 → 读数字 → 说原因 → 说后果」。
 *
 * 三个口径必须分清，写错任何一个都会被评审追问：
 *   3531  编目里属于这一事件的全部碎片（含已再入）
 *   2311  其中仍在轨的
 *   1979  其中仍有公开轨道根数、因而能被逐一定位的
 * 高度分布图的 1979 个点用的是第三个口径；第五章的清除率用的是第一个。
 * 两者不能互相加减，页面上各自标注。
 */

import { int, fixed } from '../core/format';
import type { Figures } from './figures';
import type { StepCopy } from './chapter1';

export const CHAPTER_THREE_STEPS: StepCopy[] = [
  {
    id: 'fy-arrive',
    nav: '一次试验',
    scene: 'fy-arrive',
    pinRatio: 1.1,
    render: (f) => {
      const g = f.debris.find((d) => d.key === 'fengyun1c');
      if (!g) return '';
      return `
      <div class="chapter-mark"><b>第三节</b><span>2007 年 1 月 11 日</span></div>
      <h2>一次试验，两千片碎片</h2>
      <p>
        那一天，一枚动能拦截器在约 865 公里的高度击中了一颗已经失效的气象卫星
        ——风云一号C。卫星被撞成数以千计的碎片。
      </p>
      <p>
        画面里那些橙色的点，就是这次事件至今仍能被逐一定位的
        <strong>${int(g.count)}</strong> 个碎片。它们不是模拟，每一个都有
        独立的轨道根数。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">可定位碎片</span>
          <span class="readout-v is-warn">${int(g.count)}<small>个</small></span>
          <div class="readout-note">
            这是编目里仍有公开轨道根数的部分，位置可逐一解算。
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">编目中属于该事件的碎片</span>
          <span class="readout-v">${int(familyTotal(f, 'fengyun1c'))}<small>个</small></span>
          <div class="readout-note">
            含已经再入的 ${int(familyDecayed(f, 'fengyun1c'))} 个与已失去跟踪的部分。
            口径不同，不与左侧相加。
          </div>
        </div>
      </div>
      <p class="cite">
        <b>口径</b> 左侧为 GP 轨道根数集合（可定位）；右侧为 SATCAT 编目记录
        （含已再入与已失去跟踪）。两者交集是左侧这一部分，
        因此右侧数值更大。
      </p>
    `;
    },
  },
  {
    id: 'fy-shell',
    nav: '分布',
    scene: 'fy-shell',
    pinRatio: 1.5,
    render: (f) => {
      const g = f.debris.find((d) => d.key === 'fengyun1c');
      if (!g) return '';
      const bins = (g.perigeeBins ?? []).filter((b) => b.count > 0);
      const max = Math.max(1, ...bins.map((b) => b.count));
      const rows = bins
        .map((b) => {
          // 主峰区间在 750–850 km。用暖色标出，与后文的大气清除讨论呼应。
          const hot = b.lo >= 750 && b.lo < 850;
          return `
          <div class="band-row${hot ? ' is-hot' : ''}">
            <span class="band-label mono">${b.lo}–${b.hi}</span>
            <span class="band-track"><span class="band-fill" style="width:${((b.count / max) * 100).toFixed(1)}%"></span></span>
            <span class="band-value mono">${int(b.count)}</span>
          </div>`;
        })
        .join('');

      const peak = bins.reduce((a, b) => (b.count > a.count ? b : a), bins[0]);
      const mid = bins.reduce((a, b) => (b.lo === 750 ? b : a), bins[0]);
      const high = bins.reduce((a, b) => (b.lo === 800 ? b : a), bins[0]);

      return `
      <h2>碎片没有留在它被撞碎的那个高度</h2>
      <p>
        把 ${int(g.count)} 个碎片按近地点高度分层，得到一条很不寻常的曲线：
        它不是在撞击高度附近堆积，而是明显偏向更高的一侧。
      </p>
      <div class="bands">${rows}</div>
      <p>
        最高的两档——<strong>${mid ? `${mid.lo}–${mid.hi}` : '750–800'} 公里</strong>与
        <strong>${high ? `${high.lo}–${high.hi}` : '800–850'} 公里</strong>——
        各自装有 ${int(mid ? mid.count : 0)} 个与 ${int(high ? high.count : 0)} 个碎片，
        是所有区间里最多的两段。
        其中 ${int(g.above800km)} 个碎片的近地点在 800 公里以上。
      </p>
      <div class="finding">
        <p>
          撞击发生在 865 公里，但碎片的近地点中位数是
          <strong>${fixed(g.perigeeMedianKm)} 公里</strong>，
          也就是说：这批碎片里超过一半的轨道最低点，比它诞生时更低——
          而它们的轨道最高点则更高。能量把碎片撒成了一个很宽的壳，
          而大气只对最低的那部分起作用。
        </p>
      </div>
      <p class="cite">
        <b>口径</b> 高度一律为近地点高度，由轨道半长轴与偏心率反算
        （a(1−e) − R⊕，R⊕ = 6378.137 km）。近地点决定大气阻力能否清除该目标：
        它足够低，每转一圈都会减速，轨道才会持续衰减。
        分箱宽度 50 公里，仅显示有碎片的区间。
        近地点范围 ${fixed(g.perigeeMinKm)}–${fixed(g.perigeeMaxKm)} 公里，
        峰值在 ${peak ? `${peak.lo}–${peak.hi}` : '-'} 公里。
      </p>
    `;
    },
  },
  {
    id: 'fy-band',
    nav: '为什么危险',
    scene: 'fy-band',
    pinRatio: 1.3,
    render: (f) => {
      const g = f.debris.find((d) => d.key === 'fengyun1c');
      if (!g) return '';
      return `
      <h2>750 公里以上，大气几乎不再起作用</h2>
      <p>
        近地轨道上唯一能自然清除物体的机制是大气阻力。
        而大气密度随高度指数衰减：在 400 公里处还足以让轨道持续衰减，
        到 800 公里以上，密度已经低到几乎不产生可测量的阻力。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">可定位碎片中位于 800 km 以上</span>
          <span class="readout-v is-warn">${int(g.above800km)}<small>个</small></span>
          <div class="readout-note">
            占该群的 ${fixed((g.above800km / g.count) * 100)}%。
            这一层同时是太阳同步轨道所在的常用高度，是在轨资产密集区。
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">该群近地点中位数</span>
          <span class="readout-v">${fixed(g.perigeeMedianKm)}<small>km</small></span>
          <div class="readout-note">
            落在 750–800 公里之间，正好在大气清除能力的边缘之外。
          </div>
        </div>
      </div>
      <div class="finding is-warn">
        <p>
          撞击发生的高度，不等于碎片停留的高度。
          这次事件真正的问题不在于产生了多少碎片，而在于它把大批碎片
          送进了一个它们几乎不会离开的高度层。
        </p>
      </div>
      <p class="cite">
        <b>关于大气密度</b> 本页不对大气密度做数值建模，也不画密度曲线——
        那需要引入标准大气模型及其太阳活动参数，超出本作的数据范围，
        画出来也只是示意图。这里改为给出可核验的机制：
        大气密度随高度单调衰减，因此阻力造成的轨道衰减时标随高度剧烈增长。
        下一节用编目数据自身把这件事量化出来，不再依赖任何模型。
      </p>
    `;
    },
  },
  {
    id: 'fy-verdict',
    nav: '小结',
    scene: 'fy-edge',
    pinRatio: 1.2,
    render: (f) => {
      const g = f.debris.find((d) => d.key === 'fengyun1c');
      if (!g) return '';
      return `
      <h2>这一节的两个数字</h2>
      <p>
        一，这次事件在编目里留下了 <strong>${int(familyTotal(f, 'fengyun1c'))}</strong> 个碎片，
        其中仍有公开轨道根数、能被逐一定位的 <strong>${int(g.count)}</strong> 个。
        二，这 ${int(g.count)} 个里有 <strong>${int(g.above800km)}</strong> 个
        位于 800 公里以上——按上一节讲的机制，它们中的大多数
        不会在可以预见的将来自行离开。
      </p>
      <p>
        下一节要处理的是一次不同的解体：不是被拦截器击碎的，
        而是两颗卫星在轨道上撞上的。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">下一节</span>
          <span class="readout-v">2009 年 2 月 10 日</span>
        </div>
      </div>
    `;
    },
  },
];

/** 该碎片家族在 SATCAT 编目里的总数（含已再入）。 */
function familyTotal(f: Figures, key: string): number {
  return f.familySummary.find((x) => x.key === key)?.total ?? 0;
}

/** 该碎片家族已再入的数量。 */
function familyDecayed(f: Figures, key: string): number {
  return f.familySummary.find((x) => x.key === key)?.decayed ?? 0;
}
