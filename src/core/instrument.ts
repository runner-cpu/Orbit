/**
 * 仪器层：把「叙事步骤想要什么画面」扩展成「叙事步骤想要什么画面 + 哪台仪器」。
 *
 * 为什么需要这一层：
 *   场景表原本只有 13 个字段，全部在描述「哪些点可见、机位在哪」。
 *   它能表达「只留 750-850 公里这一层」，但表达不了「这里有一条带刻度的
 *   高度轴，用户能点上去」。没有坐标轴与刻度，右栏就只能是「球 + 点」，
 *   21 个场景之间的差别只是机位微调，观众看到的是一张图在动。
 *
 * 两条设计约定：
 *
 *   一、仪器用 DOM + SVG，不用 WebGL。
 *   刻度、标签、悬停命中检测是 DOM 的强项；在 canvas 里做这些要自己写
 *   命中检测与文字排版。球继续走 WebGL，两者叠在同一个容器里。
 *
 *   二、仪器只发意图，不改状态。
 *   仪器不直接碰 PointLayer。它把「用户点了 400-600 公里这一层」这件事
 *   作为 InstrumentIntent 抛出去，由场景层决定怎么落到 uniform 上。
 *   这样仪器不需要知道点云的接口，点云也不需要知道仪器的存在。
 *
 *   三、用户的输入优先于场景表，但在切场景时失效。
 *   否则用户拖动年份轴到 1980 年之后继续滚动，下一步会带着 1980 这个
 *   残留状态进去，画面与文案对不上。
 */

import type { Figures } from '../content/figures';

/** 七台仪器的标识。与 scenes.ts 的 SceneState.instrument 一一对应。 */
export type InstrumentId =
  | 'altitude'
  | 'category'
  | 'year'
  | 'perigee'
  | 'family'
  | 'plane'
  | 'decay';

/**
 * 仪器抛给场景层的用户意图。
 *
 * 每种意图都带完整的参数，不依赖「上一次拖到哪」这种隐含状态：
 * 场景层收到的永远是一个自足的目标状态。
 */
export type InstrumentIntent =
  /** 第一章：只看某个高度层。hi 为 null 表示该层没有上界。 */
  | { kind: 'altitude-band'; lo: number; hi: number | null }
  /** 第一章：只看某一类对象。category 为 null 表示全部。 */
  | { kind: 'category'; category: number | null }
  /** 第二章：时间切到某一年。 */
  | { kind: 'year'; year: number }
  /** 第三章：只看某个近地点区间。 */
  | { kind: 'perigee-bin'; lo: number; hi: number }
  /** 第三到五章：只看某个碎片群。group 为 null 表示全部。 */
  | { kind: 'debris-group'; group: number | null }
  /** 第四章：把场景绕轴转到某个方位角。 */
  | { kind: 'plane-angle'; azimuth: number }
  /** 第五章：时间推进到第几年。 */
  | { kind: 'horizon'; years: number }
  /** 任何一台仪器：撤销用户输入，回到场景表定义的默认状态。 */
  | { kind: 'reset' };

/** 仪器每次需要重绘时收到的数据。 */
export interface InstrumentPayload {
  figures: Figures;
  /** 当前场景标识，仪器可以据此判断自己是否该改变呈现 */
  scene: string;
  /** 场景进度 0-1，仪器可用它做与滚动同步的微调 */
  progress: number;
  /** 当前生效的年份上限（null = 不筛选），第二章的仪器回读它 */
  yearMax: number | null;
  /** 当前生效的时间推进量 0-1，第五章的仪器回读它 */
  horizon: number;
  /** 当前场景预设的碎片群筛选（null = 全部），第三、四章的仪器回读它 */
  debrisGroups: { lo: number; hi: number } | null;
  /** 用户当前锁定的对象类别（null = 跟随场景），第一章的仪器回读它 */
  category: number | null;
  /** 用户当前锁定的碎片群（null = 跟随场景），第三、四章的仪器回读它 */
  group: number | null;
}

/**
 * 一台仪器。
 *
 * 生命周期：create 一次，mount 到容器，之后由场景层按需 update。
 * 卸载时不销毁 DOM，只做淡出并停止响应，避免反复创建造成状态丢失。
 */
export interface Instrument {
  readonly id: InstrumentId;
  /** 无障碍名称，会写进 aria-label */
  readonly label: string;
  /** 创建 DOM 并挂到 host 上 */
  mount(host: HTMLElement, emit: (intent: InstrumentIntent) => void): void;
  /** 用新数据重绘。可能被每帧调用，实现内部应做脏检查。 */
  update(p: InstrumentPayload): void;
  /** 显示 / 隐藏（切场景时用，不销毁） */
  setVisible(v: boolean): void;
  /**
   * 丢掉用户输入，回到「跟随场景」的状态。
   *
   * 为什么需要它：一台仪器可能连续挂在几步上（第三到五章各有这种情况）。
   * 同一台仪器跨场景时宿主不会重建它，于是上一步拖过的游标、点过的档位
   * 会留在 DOM 里，而场景层已经把筛选撤销了：画面上是全部，读数上却是
   * 「已锁定某一档」。切场景时由宿主调一次，两边就始终一致。
   */
  resetUserState(): void;
  /** 当前是否有指针停在仪器上或正在拖动 */
  readonly engaged: boolean;
}

/**
 * 仪器宿主：管一个容器，按需切换当前仪器。
 *
 * 五台仪器全部提前创建并挂载，切换只是显隐。
 * 这样切场景时不需要重建 SVG，也不会有一次布局抖动。
 */
export interface InstrumentHost {
  /** 切换当前仪器。传 null 表示这一步没有仪器。 */
  set(id: InstrumentId | null): void;
  /** 把数据推给当前仪器 */
  update(p: InstrumentPayload): void;
  /**
   * 让当前仪器丢掉用户输入。切场景时由主循环调用。
   *
   * 与 set 分开的原因：一台仪器会连续挂在同一章的几步上（第三到五章都有），
   * 这时 set 收到的 id 与当前相同、直接早退，但场景表里的筛选已经换了，
   * 仪器上的游标与锁定状态必须跟着回到默认，否则读数与画面不一致。
   */
  resetUserState(): void;
  /** 用户是否正在操作仪器。为真时叙事层应暂停自动推进。 */
  readonly engaged: boolean;
  /** 当前仪器标识 */
  readonly current: InstrumentId | null;
}

export function createInstrumentHost(
  root: HTMLElement,
  factories: Record<InstrumentId, () => Instrument>,
  emit: (intent: InstrumentIntent) => void
): InstrumentHost {
  const instances = new Map<InstrumentId, Instrument>();

  function get(id: InstrumentId): Instrument {
    let inst = instances.get(id);
    if (!inst) {
      inst = factories[id]();
      inst.mount(root, emit);
      inst.setVisible(false);
      instances.set(id, inst);
    }
    return inst;
  }

  let current: InstrumentId | null = null;

  return {
    set(id) {
      if (id === current) return;
      if (current) get(current).setVisible(false);
      current = id;
      if (id) {
        get(id).setVisible(true);
        // 切到新仪器时撤销上一步的用户输入：
        // 两台仪器表达的是不同的量，把 A 的筛选带到 B 上没有意义。
        emit({ kind: 'reset' });
      }
    },
    update(p) {
      if (current) get(current).update(p);
    },
    resetUserState() {
      if (current) get(current).resetUserState();
    },
    get engaged() {
      return current ? get(current).engaged : false;
    },
    get current() {
      return current;
    },
  };
}

/* ============================================================================
   仪器实现的公共工具
   ========================================================================== */

/** 创建一个 SVG 元素。仪器全部用 SVG 画，尺寸由 CSS 控制。 */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** 创建普通元素，带类名与可选文本。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 把指针事件换算成 [0,1] 的归一化位置。
 *
 * 用 getBoundingClientRect 而不是 offsetX：拖动时指针会移出元素，
 * offsetX 在移出后不再可靠，而 rect 始终有效。
 */
export function pointerFraction(
  e: PointerEvent,
  target: Element,
  axis: 'x' | 'y' = 'x'
): number {
  const r = target.getBoundingClientRect();
  if (axis === 'x') return clamp01((e.clientX - r.left) / Math.max(1, r.width));
  // 纵向按「下为 0、上为 1」折算，符合高度轴的直觉
  return clamp01(1 - (e.clientY - r.top) / Math.max(1, r.height));
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 给一个元素接上拖拽。
 *
 * 用 pointer capture 而不是在 window 上挂 mousemove：
 * 指针移出元素甚至移出窗口时仍能收到事件，松手也不会漏掉 pointerup
 * 导致「一直处于拖动中」。触摸设备上同一套代码可用。
 */
export function attachDrag(
  target: HTMLElement,
  onMove: (e: PointerEvent) => void,
  onStateChange?: (dragging: boolean) => void
): () => void {
  let dragging = false;

  const down = (e: PointerEvent) => {
    dragging = true;
    target.setPointerCapture(e.pointerId);
    onStateChange?.(true);
    onMove(e);
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (dragging) onMove(e);
  };
  const up = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    onStateChange?.(false);
  };

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);

  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
  };
}

/**
 * 键盘可操作性。
 *
 * 仪器必须能用方向键操作，否则整块内容对键盘用户不可达。
 * 左右键走一个步长，Home / End 跳到两端，Escape 撤销用户输入。
 */
export function attachKeys(
  target: HTMLElement,
  opts: {
    step: (dir: -1 | 1, big: boolean) => void;
    home?: () => void;
    end?: () => void;
    reset?: () => void;
  }
): () => void {
  const onKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        opts.step(-1, e.shiftKey);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        opts.step(1, e.shiftKey);
        break;
      case 'Home':
        opts.home?.();
        break;
      case 'End':
        opts.end?.();
        break;
      case 'Escape':
        opts.reset?.();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
