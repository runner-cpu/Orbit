/**
 * 第二章的仪器：年份轴。
 *
 * 回答的问题是「现在这么多，是从哪一年开始变成这样的」。
 * 做法：横轴是真的年份刻度（1957 到数据末年），轴上画两条逐年累积曲线，
 * 曲线上的陡增段就是台阶。游标可以拖，拖到哪一年，球上就只剩那一年
 * 已经存在的对象。
 *
 * 为什么必须让游标真的改变球：
 *   只画一条曲线、游标跟着滚动走，读者看到的还是「一张图在动」。
 *   让游标驱动点云之后，「1980 年只有这么几个」与「2026 年有这么多」
 *   是同一个画面在两个时刻的样子，这句话才成立。
 *
 * 为什么画两条曲线：
 *   本章引用的数字来自 SATCAT 编目记录（含已再入与已失去跟踪的对象），
 *   而球上画的是其中仍有公开轨道根数、因而能被逐一定位的那一批。
 *   两者相差一个数量级，且差得越来越多。只画一条会让读者对不上：
 *   轴上写着 2,087，球上只有 5 个点。两条曲线并排之后，
 *   这个落差本身成为可读的信息，游标读数也同时给出两个数。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachDrag, attachKeys, el, pointerFraction, svgEl } from '../../core/instrument';
import { int } from '../../core/format';

const W = 560;
const H = 150;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 18;
const PAD_B = 30;

export function createYearInstrument(): Instrument {
  let root: HTMLElement;
  let svg: SVGSVGElement;
  let curveAll: SVGPathElement;
  let curveLocated: SVGPathElement;
  let cursor: SVGGElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  let dragging = false;
  let userYear: number | null = null;
  /** 当前画面上生效的年份。键盘微调以它为基准，否则一按就跳到另一端。 */
  let shownYear = 1957;

  // 数据范围在第一次 update 时确定，之后不再变
  let y0 = 1957;
  let y1 = 2026;
  let maxCum = 1;
  /** SATCAT 编目在轨总量，逐年 */
  const cumAll = new Map<number, number>();
  /** 可定位集合的累积发射数，逐年 */
  const cumLocated = new Map<number, number>();

  function yearToX(year: number): number {
    const t = (year - y0) / Math.max(1, y1 - y0);
    return PAD_L + t * (W - PAD_L - PAD_R);
  }

  function xToYear(x: number): number {
    const t = (x - PAD_L) / Math.max(1, W - PAD_L - PAD_R);
    return Math.round(y0 + t * (y1 - y0));
  }

  function cumToY(v: number): number {
    const t = v / maxCum;
    return H - PAD_B - t * (H - PAD_T - PAD_B);
  }

  /** 逐年累积折线。台阶在曲线上表现为斜率突变，这正是本章要读者看见的东西。 */
  function pathFor(points: { x: number; y: number }[]): string {
    let d = '';
    points.forEach((p, i) => {
      d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    });
    return d;
  }

  function paint(p: InstrumentPayload) {
    const series = p.figures.historySeries;
    if (!series.length) return;

    y0 = p.figures.historyFirstYear;
    y1 = p.figures.historyLastYear;
    maxCum = Math.max(1, series[series.length - 1].inOrbit);

    cumAll.clear();
    for (const s of series) cumAll.set(s.year, s.inOrbit);

    // 可定位集合的逐年累积：由发射年直方图累加得出。
    // 它的量级远小于上面那条，但仍画在同一条纵轴上：
    // 两条曲线之间的距离就是两个口径的差距，换轴会把这件事抹掉。
    cumLocated.clear();
    let run = 0;
    for (const r of p.figures.launchCumulative) {
      run += r.count;
      cumLocated.set(r.year, run);
    }

    curveAll.setAttribute(
      'd',
      pathFor(series.map((s) => ({ x: yearToX(s.year), y: cumToY(s.inOrbit) })))
    );
    curveLocated.setAttribute(
      'd',
      pathFor(
        p.figures.launchCumulative.map((r) => ({ x: yearToX(r.year), y: cumToY(r.cumulative) }))
      )
    );
  }

  /** 游标位置与读数。用户拖过就用用户的年份，否则跟随场景的年份上限。 */
  function syncCursor(p: InstrumentPayload) {
    const year = userYear ?? p.yearMax ?? y1;
    shownYear = year;
    cursor.setAttribute('transform', `translate(${yearToX(year).toFixed(1)} 0)`);

    const all = cumAll.get(year) ?? cumAll.get(y1) ?? 0;
    const located = cumLocated.get(year) ?? 0;
    readHost.textContent = `${year} 年末 · 编目在轨 ${int(all)} 个 · 画面内 ${int(located)} 个`;
    root.dataset.userDriven = String(userYear !== null);
  }

  return {
    id: 'year',
    label: '年份轴',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-year');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '年份轴：拖动游标可看某一年的在轨数量');

      svg = svgEl('svg', {
        viewBox: `0 0 ${W} ${H}`,
        preserveAspectRatio: 'none',
        class: 'year-svg',
      });

      // 基线
      svg.append(
        svgEl('line', {
          x1: PAD_L,
          y1: H - PAD_B,
          x2: W - PAD_R,
          y2: H - PAD_B,
          class: 'year-axis-line',
        })
      );

      // 可定位那条先画：它在下层，读者先看到的是完整编目那条。
      curveLocated = svgEl('path', { class: 'year-curve is-located' });
      curveAll = svgEl('path', { class: 'year-curve' });
      svg.append(curveLocated, curveAll);

      // 游标：一条竖线加顶端一个方块，方块是拖拽把手
      cursor = svgEl('g', { class: 'year-cursor' });
      cursor.append(
        svgEl('line', { x1: 0, y1: PAD_T - 6, x2: 0, y2: H - PAD_B, class: 'year-cursor-line' }),
        svgEl('rect', { x: -5, y: PAD_T - 12, width: 10, height: 10, class: 'year-cursor-grip' })
      );
      svg.append(cursor);

      // 年份刻度：每 20 年一条
      const ticks = svgEl('g', { class: 'year-ticks' });
      for (let yr = 1960; yr <= 2026; yr += 20) {
        const x = yearToX(yr);
        ticks.append(
          svgEl('line', { x1: x, y1: H - PAD_B, x2: x, y2: H - PAD_B + 4, class: 'year-tick' })
        );
        const t = svgEl('text', {
          x,
          y: H - PAD_B + 16,
          class: 'year-tick-label',
          'text-anchor': 'middle',
        });
        t.textContent = String(yr);
        ticks.append(t);
      }
      svg.append(ticks);

      // 图例：两条曲线各是什么。没有它，读者会以为下面那条是上面那条的一部分。
      const legend = el('div', 'year-legend');
      legend.append(
        el('span', 'year-legend-item is-all', '编目在轨（含已再入与无根数）'),
        el('span', 'year-legend-item is-located', '画面内（有公开根数）')
      );

      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      root.append(svg, legend, readHost);
      host.append(root);

      const apply = (e: PointerEvent) => {
        // 换算用 svg 的矩形，事件挂在整块 root 上：这样从读数文字上起拖也能拖动，
        // 命中面积更大，触摸设备上更好按。
        const f = pointerFraction(e, svg, 'x');
        const year = xToYear(PAD_L + f * (W - PAD_L - PAD_R));
        userYear = Math.max(y0, Math.min(y1, year));
        emitFn({ kind: 'year', year: userYear });
      };

      attachDrag(root, apply, (d) => {
        dragging = d;
      });

      root.tabIndex = 0;
      attachKeys(root, {
        step: (dir, big) => {
          // 以画面上当前的年份为基准，而不是以数据末端为基准：
          // 否则在 1965 那一步按一下右键会直接跳到 2026。
          const cur = userYear ?? shownYear;
          userYear = Math.max(y0, Math.min(y1, cur + dir * (big ? 10 : 1)));
          emitFn({ kind: 'year', year: userYear });
        },
        home: () => {
          userYear = y0;
          emitFn({ kind: 'year', year: y0 });
        },
        end: () => {
          userYear = y1;
          emitFn({ kind: 'year', year: y1 });
        },
        reset: () => {
          userYear = null;
          emitFn({ kind: 'reset' });
        },
      });
    },
    update(p) {
      if (svg.dataset.painted !== '1') {
        paint(p);
        svg.dataset.painted = '1';
      }
      syncCursor(p);
    },
    setVisible(v) {
      root.hidden = !v;
    },
    resetUserState() {
      userYear = null;
    },
    get engaged() {
      return dragging;
    },
  };
}
