/**
 * 第四章的仪器：双轨道面转盘。
 *
 * 回答的问题是「两个碎片云为什么不在同一个面」。做法：两个同心环表示
 * 两个轨道面的倾角（73.5-74.3° 与 86.0-86.5°），中间那条斜线是两个面的
 * 交线，夹角直接标出来。拖动可以绕轴旋转，两个碎片云跟着转，
 * 「它们确实来自两个方向」这件事就从一句话变成可以自己转出来的观察。
 *
 * 为什么用转盘而不是直接写「相差 12°」：
 *   12° 是一个抽象数字。把它画成两个环之间的实际夹角，并允许读者转动它，
 *   读者才会意识到「两条轨道必然相交于两点」是几何必然，不是巧合。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachDrag, attachKeys, el, pointerFraction, svgEl } from '../../core/instrument';
import { fixed } from '../../core/format';

const W = 300;
const H = 300;
const CX = W / 2;
const CY = H / 2;

/** 环的视觉半径。两个面倾角相差 12°，画成半径差会让对比失真，因此用等半径。 */
const R = 104;

export function createPlaneInstrument(): Instrument {
  let root: HTMLElement;
  let svg: SVGSVGElement;
  let ringA: SVGGElement;
  let ringB: SVGGElement;
  let angleLabel: SVGTextElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  let dragging = false;
  let azimuth = 0.15; // 与场景表 impact-plane 的初始方位角一致
  let painted = false;

  /**
   * 把一个「轨道面」画成椭圆。
   *
   * 倾角 i 对应的轨道面在赤道系里是一个倾斜的圆。沿视线方向看过去，
   * 它投影成椭圆，短轴与长轴之比等于视线与面法线的夹角正弦。
   * 这里用 ry = R·cos(倾角) 做近似：倾角越大，环看起来越「立」，
   * 与真实的三维观感方向一致。这是示意，不承担定量职责，
   * 定量部分由旁边标注的倾角区间承担。
   */
  function ellipseFor(inclDeg: number): SVGEllipseElement {
    const rad = (inclDeg * Math.PI) / 180;
    const ry = Math.max(6, R * Math.cos(rad));
    return svgEl('ellipse', {
      cx: CX,
      cy: CY,
      rx: R,
      ry: ry.toFixed(1),
      class: 'plane-ring',
    });
  }

  function paint(p: InstrumentPayload) {
    const c = p.figures.debris.find((d) => d.key === 'cosmos2251');
    const i = p.figures.debris.find((d) => d.key === 'iridium33');
    if (!c || !i || painted) return;
    painted = true;

    ringA = svgEl('g', { class: 'plane-set plane-a' });
    ringA.append(ellipseFor(c.inclMedianDeg));
    ringB = svgEl('g', { class: 'plane-set plane-b' });
    ringB.append(ellipseFor(i.inclMedianDeg));

    // 交线：两个面共有的那条线。画成穿过圆心的一条实线，
    // 它存在的意思是「两个面必然相交」，不是装饰。
    const cross = svgEl('g', { class: 'plane-cross' });
    cross.append(
      svgEl('line', {
        x1: CX - R * 0.94,
        y1: CY - R * 0.34,
        x2: CX + R * 0.94,
        y2: CY + R * 0.34,
        class: 'plane-cross-line',
      })
    );

    angleLabel = svgEl('text', {
      x: CX,
      y: CY + R + 40,
      class: 'plane-angle-label mono',
      'text-anchor': 'middle',
    });
    angleLabel.textContent = `面夹角 ${fixed(Math.abs(i.inclMedianDeg - c.inclMedianDeg))}°`;

    svg.append(ringA, ringB, cross, angleLabel);
  }

  function sync(p: InstrumentPayload) {
    const c = p.figures.debris.find((d) => d.key === 'cosmos2251');
    const i = p.figures.debris.find((d) => d.key === 'iridium33');
    if (!c || !i) return;

    // 环整体绕中心旋转，模拟「从不同方向看这两个面」
    ringA.setAttribute('transform', `rotate(${(-azimuth * 57.3).toFixed(1)} ${CX} ${CY})`);
    ringB.setAttribute('transform', `rotate(${(-azimuth * 57.3).toFixed(1)} ${CX} ${CY})`);

    readHost.textContent =
      `宇宙 2251 ${fixed(c.inclMedianDeg)}° · 铱星 33 ${fixed(i.inclMedianDeg)}° · 拖动可转`;
    root.dataset.userDriven = String(dragging);
  }

  return {
    id: 'plane',
    label: '双轨道面转盘',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-plane');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '双轨道面转盘：拖动可旋转视角');

      svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plane-svg' });
      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      root.append(svg, readHost);
      host.append(root);

      const apply = (e: PointerEvent) => {
        // 横向拖动 1 个视口宽度 ≈ 转半圈，手感接近直接拨动转盘
        const f = pointerFraction(e, svg, 'x');
        azimuth = (f - 0.5) * Math.PI;
        emitFn({ kind: 'plane-angle', azimuth });
      };
      attachDrag(root, apply, (d) => {
        dragging = d;
      });

      root.tabIndex = 0;
      attachKeys(root, {
        step: (dir, big) => {
          azimuth = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, azimuth + dir * (big ? 0.3 : 0.08)));
          emitFn({ kind: 'plane-angle', azimuth });
        },
        reset: () => {
          azimuth = 0.15;
          emitFn({ kind: 'reset' });
        },
      });
    },
    update(p) {
      paint(p);
      sync(p);
    },
    setVisible(v) {
      root.hidden = !v;
    },
    get engaged() {
      return dragging;
    },
  };
}
