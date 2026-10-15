/**
 * 第二章的仪器：年份轴。
 *
 * 回答的问题是「现在这么多，是从哪一年开始变成这样的」。
 * 做法：横轴是真的年份刻度（1957 到数据末年），轴上画一条逐年累积曲线，
 * 曲线上的陡增段就是台阶。游标可以拖，拖到哪一年，球上就只剩那一年
 * 已经存在的对象。
 *
 * 为什么必须让游标真的改变球：
 *   只画一条曲线、游标跟着滚动走，读者看到的还是「一张图在动」。
 *   让游标驱动点云之后，「1980 年只有这么几个」与「2026 年有这么多」
 *   是同一个画面在两个时刻的样子，这句话才成立。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachDrag, attachKeys, el, pointerFraction, svgEl } from '../../core/instrument';
import { int } from '../../core/format';

const W = 560;
const H = 132;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 18;
const PAD_B = 26;

export function createYearInstrument(): Instrument {
  let root: HTMLElement;
  let svg: SVGSVGElement;
  let curve: SVGPathElement;
  let cursor: SVGGElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  let dragging = false;
  let userYear: number | null = null;

  // 数据范围在第一次 update 时确定，之后不再变
  let y0 = 1957;
  let y1 = 2026;
  let maxCum = 1;
  const cumAt = new Map<number, number>();

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

  function paint(p: InstrumentPayload) {
    const series = p.figures.historySeries;
    if (!series.length) return;

    y0 = p.figures.historyFirstYear;
    y1 = p.figures.historyLastYear;
    maxCum = Math.max(1, series[series.length - 1].inOrbit);
    cumAt.clear();
    for (const s of series) cumAt.set(s.year, s.inOrbit);

    // 累积曲线：逐年折线。台阶在曲线上表现为斜率突变，
    // 这正是本章要读者看见的东西。
    let d = '';
    series.forEach((s, i) => {
      const x = yearToX(s.year);
      const y = cumToY(s.inOrbit);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    curve.setAttribute('d', d);
  }

  /** 游标位置与读数。用户拖过就用用户的年份，否则跟随场景的年份上限。 */
  function syncCursor(p: InstrumentPayload) {
    const year = userYear ?? p.yearMax ?? y1;
    const x = yearToX(year);
    cursor.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);

    const v = cumAt.get(year) ?? cumAt.get(y1) ?? 0;
    readHost.textContent = `${year} 年末 · 已在轨 ${int(v)} 个`;
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

      curve = svgEl('path', { class: 'year-curve' });
      svg.append(curve);

      // 游标：一条竖线加顶端一个方块，方块是拖拽把手
      cursor = svgEl('g', { class: 'year-cursor' });
      cursor.append(
        svgEl('line', { x1: 0, y1: PAD_T - 6, x2: 0, y2: H - PAD_B, class: 'year-cursor-line' }),
        svgEl('rect', { x: -5, y: PAD_T - 12, width: 10, height: 10, class: 'year-cursor-grip' })
      );
      svg.append(cursor);

      // 年份刻度：每 20 年一条，末年在上面
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

      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      root.append(svg, readHost);
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
          const cur = userYear ?? y1;
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
    get engaged() {
      return dragging;
    },
  };
}
