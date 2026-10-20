/**
 * 时间对照：把「2015 年」与「现在」放进同一张画面，中间一条可拖的中缝。
 *
 * 为什么需要它：
 *   第二章的年份轴已经能拖出任意一年，但「某一年」与「2026」始终是两个
 *   先后出现的画面，读者要靠记忆比较。时间对照把两批点同时渲染在同一个
 *   机位上，用屏幕空间的中缝切开：左半是参考年已经发射、今天仍在轨的对象，
 *   右半是今天的全部。参考年由调用方给出（本项目取 2015，见 main.ts 的说明）。
 *   中缝左右拖动时，同一片天区在两套时间里的差别直接可见，不需要记忆。
 *
 * 为什么用 scissor 而不是两个 canvas：
 *   两个 canvas 会有两套相机、两套尺寸换算，视口一变就容易错位。
 *   这里共用同一个场景与相机，只把渲染区域裁成左右两半，各画一次：
 *   左半让参考年层可见、右半让全部层可见。地球、星空与参考层在两次
 *   渲染里完全相同，唯一的变量就是点云的时间切片。
 *
 * 为什么是一个全屏模式而不是嵌在页面里：
 *   桌面端左栏是正文、右下角是仪器，任何固定面板都会把中缝切成几段。
 *   全屏模式暂时收起正文与仪器，读者只需要比较两半画面；退出后页面
 *   原样恢复。它也正好是一个适合答辩演示的「证据镜头」。
 */

import * as THREE from 'three';
import type { CameraRig } from './camera';
import type { PointLayer } from './pointCloud';
import { el } from './instrument';
import { int } from './format';

export interface CompareLabels {
  pastYear: number;
  nowYear: number;
  pastAll: number;
  pastLocated: number;
  nowAll: number;
  nowLocated: number;
}

export interface CompareOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  rig: CameraRig;
  /** 全量层：右半画面用它 */
  layer: PointLayer;
  /** 参考年层（本项目为 2015）：左半画面用它 */
  pastLayer: PointLayer;
  labels: CompareLabels;
  /** 进入对照时由主循环收起筛选、把机位拉到全景 */
  onOpen?: () => void;
  /** 退出时由主循环重跑当前场景，恢复机位与筛选 */
  onClose?: () => void;
}

export interface CompareMode {
  readonly active: boolean;
  /** 中缝位置 0-1，供自动化校验 */
  readonly wipe: number;
  open(): void;
  close(): void;
  toggle(): void;
  /** 每一帧调用；只在 active 时真正渲染 */
  render(): void;
}

export function createCompareMode(opts: CompareOptions): CompareMode {
  const { renderer, scene, rig, layer, pastLayer, labels } = opts;

  const root = el('div', 'compare-stage');
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');

  const head = el('div', 'compare-head');
  const kicker = el('span', 'compare-kicker mono', '时间对照 · 拖动中缝');
  const closeBtn = el('button', 'compare-close mono', '退出 Esc');
  closeBtn.type = 'button';
  head.append(kicker, closeBtn);

  const leftCard = el('div', 'compare-side compare-left');
  // 左侧的口径必须写全：编目序列是「那一年在轨多少」，点云是「那一年以前
  // 发射、到今天仍有公开根数的那一批」。两者相差一个数量级，只写年份会让
  // 读者以为左边那一片点就是参考年的全部。
  leftCard.innerHTML = `
    <span class="compare-year mono">≤ ${labels.pastYear} 年发射</span>
    <span class="compare-count mono">当年编目在轨 ${int(labels.pastAll)} · 今天仍可定位 ${int(labels.pastLocated)}</span>`;
  const rightCard = el('div', 'compare-side compare-right');
  rightCard.innerHTML = `
    <span class="compare-year mono">${labels.nowYear} 年 · 全部</span>
    <span class="compare-count mono">编目 ${int(labels.nowAll)} · 画面内 ${int(labels.nowLocated)}</span>`;

  const line = el('div', 'compare-line');
  line.setAttribute('role', 'slider');
  line.tabIndex = 0;
  line.setAttribute('aria-label', '时间对照的中缝，左右方向键移动');
  line.setAttribute('aria-valuemin', '8');
  line.setAttribute('aria-valuemax', '92');
  line.setAttribute('aria-valuenow', '50');
  const handle = el('span', 'compare-handle');
  handle.setAttribute('aria-hidden', 'true');
  line.append(handle);

  const hint = el(
    'p',
    'compare-hint mono',
    `左：${labels.pastYear} 年及以前发射、今天仍在轨　右：现在的全部　·　拖动中线比较；方向键微调；Esc 退出`
  );

  root.append(head, leftCard, rightCard, line, hint);
  document.body.append(root);

  let active = false;
  let wipe = 0.5;
  /** 进入前主层是否可见由场景决定；对照期间只临时改写，退出时按场景重跑 */
  let drag = false;

  function paintLine() {
    const pct = (wipe * 100).toFixed(2);
    line.style.left = `${pct}%`;
    line.setAttribute('aria-valuenow', String(Math.round(wipe * 100)));
    // 两张年份卡各自贴着自己那一侧的中缝，拖动时跟着走
    leftCard.style.maxWidth = `calc(${pct}% - 24px)`;
    rightCard.style.maxWidth = `calc(${(100 - wipe * 100).toFixed(2)}% - 24px)`;
  }

  function setWipe(next: number) {
    wipe = Math.max(0.08, Math.min(0.92, next));
    paintLine();
  }

  function setWipeFromClientX(x: number) {
    setWipe(x / Math.max(1, window.innerWidth));
  }

  function open() {
    if (active) return;
    active = true;
    root.hidden = false;
    root.removeAttribute('aria-hidden');
    document.body.classList.add('is-comparing');
    setWipe(0.5);
    opts.onOpen?.();
    line.focus({ preventScroll: true });
  }

  function close() {
    if (!active) return;
    active = false;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-comparing');
    drag = false;
    opts.onClose?.();
  }

  closeBtn.addEventListener('click', close);
  root.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button')) return;
    drag = true;
    root.setPointerCapture(e.pointerId);
    setWipeFromClientX(e.clientX);
    e.preventDefault();
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    setWipeFromClientX(e.clientX);
  });
  const endDrag = (e: PointerEvent) => {
    drag = false;
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  line.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    switch (e.key) {
      case 'ArrowLeft':
        setWipe(wipe - step);
        break;
      case 'ArrowRight':
        setWipe(wipe + step);
        break;
      case 'Home':
        setWipe(0.08);
        break;
      case 'End':
        setWipe(0.92);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  });

  // 对照是全屏模式：滚轮与触摸不应把底下的长页滚走
  root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  window.addEventListener(
    'keydown',
    (e) => {
      if (!active || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    },
    true
  );

  paintLine();

  function render() {
    if (!active) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const x = Math.round(Math.max(1, Math.min(W - 1, wipe * W)));
    const mainVisible = layer.points.visible;

    // 两次 render 各自会清屏。第二次清屏会把左半边的结果一起擦掉，
    // 因此这里关掉自动清屏，只在开始时清一次，之后靠 scissor 限定绘制区域。
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    // 先整屏清一次，再打开裁剪。顺序反了的话，clear 本身会被上一次
    // 遗留的 scissor 限制在左半边，右半边会保留上一帧的画面。
    renderer.clear();
    renderer.setScissorTest(true);

    // 左半：参考年及以前
    layer.points.visible = false;
    pastLayer.points.visible = true;
    renderer.setScissor(0, 0, x, H);
    renderer.render(scene, rig.camera);

    // 右半：全部
    pastLayer.points.visible = false;
    layer.points.visible = true;
    renderer.setScissor(x, 0, W - x, H);
    renderer.render(scene, rig.camera);

    renderer.setScissorTest(false);
    renderer.autoClear = autoClear;
    layer.points.visible = mainVisible;
    pastLayer.points.visible = false;
  }

  return {
    get active() {
      return active;
    },
    get wipe() {
      return wipe;
    },
    open,
    close,
    toggle() {
      if (active) close();
      else open();
    },
    render,
  };
}
