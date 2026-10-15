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
 * 高度分布图用第三个口径；第五章的清除率用第一个。
 * 两者不能互相加减，这一条收进「依据」折叠块。
 */

import { int, fixed } from '../core/format';
import type { Figures } from './figures';
import { fold, nextCue, type StepCopy } from './chapter1';

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
      <p class="lead">
        一枚动能拦截器在约 865 公里处击中了失效的气象卫星风云一号C。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">可定位碎片</span>
          <span class="readout-v is-warn">${int(g.count)}<small>个</small></span>
        </div>
        <div class="readout">
          <span class="readout-k">编目中属于该事件的碎片</span>
          <span class="readout-v">${int(familyTotal(f, 'fengyun1c'))}<small>个</small></span>
        </div>
      </div>
      ${fold(`
        <p>
          左侧为 GP 轨道根数集合（可定位），右侧为 SATCAT 编目记录
          （含已再入与已失去跟踪）。两者交集是左侧这一部分，因此右侧数值更大。
          编目记录中已再入的有 ${int(familyDecayed(f, 'fengyun1c'))} 个。
        </p>`)}
    `;
    },
  },
  {
    id: 'fy-shell',
    nav: '分布',
    scene: 'fy-shell',
    pinRatio: 1.3,
    render: (f) => {
      const g = f.debris.find((d) => d.key === 'fengyun1c');
      if (!g) return '';
      const bins = (g.perigeeBins ?? []).filter((b) => b.count > 0);
      const max = Math.max(1, ...bins.map((b) => b.count));
      const rows = bins
        .map((b) => {
          // 主峰区间在 750 至 850 公里。用暖色标出，与后文的大气清除讨论呼应。
          const hot = b.lo >= 750 && b.lo < 850;
          return `
          <div class="band-row${hot ? ' is-hot' : ''}">
            <span class="band-label mono">${b.lo}-${b.hi}</span>
            <span class="band-track"><span class="band-fill" style="width:${((b.count / max) * 100).toFixed(1)}%"></span></span>
            <span class="band-value mono">${int(b.count)}</span>
          </div>`;
        })
        .join('');

      return `
      <h2>碎片没有留在撞击高度</h2>
      <p class="lead">
        近地点中位数 ${fixed(g.perigeeMedianKm)} 公里，比撞击点更低。
      </p>
      <div class="bands">${rows}</div>
      <div class="finding">
        <p>能量把碎片撒成了一个很宽的壳，大气只对最低的那部分起作用。</p>
      </div>
      ${fold(`
        <p>
          高度一律为近地点高度，由轨道半长轴与偏心率反算
          （a(1−e) − R⊕，R⊕ = 6378.137 km）。近地点决定大气阻力能否清除该目标：
          它足够低，每转一圈都会减速，轨道才会持续衰减。
          分箱宽度 50 公里，仅显示有碎片的区间。
          近地点范围 ${fixed(g.perigeeMinKm)} 至 ${fixed(g.perigeeMaxKm)} 公里。
        </p>`)}
    `;
    },
  },
  {
    id: 'fy-band',
    nav: '为什么危险',
    scene: 'fy-band',
    pinRatio: 1.2,
    render: (f) => {
      const g = f.debris.find((d) => d.key === 'fengyun1c');
      if (!g) return '';
      return `
      <h2>750 公里以上，大气失效</h2>
      <p class="lead">
        该群 ${int(g.above800km)} 个碎片的近地点在 800 公里以上，占
        ${fixed((g.above800km / g.count) * 100)}%。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">近地点中位数</span>
          <span class="readout-v">${fixed(g.perigeeMedianKm)}<small>km</small></span>
          <div class="readout-note">
            落在 750 至 800 公里之间，正好在大气清除能力的边缘之外
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">800 公里以上同时是</span>
          <span class="readout-v">太阳同步轨道<small>常用高度</small></span>
        </div>
      </div>
      <div class="finding is-warn">
        <p>撞击发生的高度，不等于碎片停留的高度。</p>
      </div>
      ${fold(`
        <p>
          本页不对大气密度做数值建模，也不画密度曲线：那需要引入标准大气模型
          及其太阳活动参数，超出本作的数据范围。这里只给出可核验的机制：
          大气密度随高度单调衰减，因此阻力造成的轨道衰减时标随高度剧烈增长。
          下一节用编目数据自身把这件事量化出来，不再依赖任何模型。
        </p>`)}
      ${nextCue('2009 年 2 月 10 日')}
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
