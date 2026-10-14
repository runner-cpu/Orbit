/**
 * 滚动叙事控制器。
 *
 * 做什么：把页面上若干「叙事节」的滚动位置映射成 0–1 的进度值，
 * 并把该进度连同节索引交给注册的回调。三维场景与文案层各自订阅，
 * 因此叙事节奏只有一个来源，不需要在渲染循环里反查 DOM。
 *
 * 为什么不用 window.scroll 监听：
 *   滚动事件在合成线程之外触发，回调里读写布局会强制同步重排。
 *   改为在渲染循环里按需读取（每帧至多一次），配合 IntersectionObserver
 *   判断当前节，滚动过程不掉帧。
 */

export interface StoryStep {
  /** 步骤 DOM 元素 */
  el: HTMLElement;
  /** 该步骤在时间轴上的标识 */
  id: string;
  /** 进入视口后持续多少视口高度算作这一步的推进区间 */
  pinRatio: number;
  /** 是否把整段滚动都算作这一步（长页文案段落） */
  isTextBlock?: boolean;
}

export interface StepState {
  index: number;
  id: string;
  /** 本步内部进度 0–1 */
  progress: number;
  /** 触发方向：1 向下，-1 向上，0 初始化 */
  direction: 1 | -1 | 0;
}

type StepListener = (state: StepState) => void;

export interface ScrollStory {
  /** 阶段变化（进入新的一步）时回调 */
  onStep(fn: StepListener): void;
  /** 每帧调用。返回是否发生了进度变化 */
  update(): boolean;
  /** 当前状态 */
  readonly state: StepState;
  /** 跳转到某一步 */
  goTo(id: string): void;
  /** 结束时清理 */
  dispose(): void;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createScrollStory(steps: StoryStep[]): ScrollStory {
  const listeners = new Set<StepListener>();
  let state: StepState = { index: 0, id: steps[0]?.id ?? '', progress: 0, direction: 0 };
  let lastScrollY = window.scrollY;
  let dirty = true;

  // 预读每步的文档区间。步骤高度在布局稳定后不会变，
  // 因此在 resize 与初始化时各测一次即可，不在滚动中反复取值。
  interface Range {
    top: number;
    height: number;
    triggerTop: number;
    triggerHeight: number;
  }
  let ranges: Range[] = [];

  function measure(): void {
    const scrollY = window.scrollY;
    ranges = steps.map((s) => {
      const rect = s.el.getBoundingClientRect();
      const top = rect.top + scrollY;
      // 推进区间高度：pinRatio 表示「几屏的滚动用于推进这一步」
      const triggerHeight = Math.max(1, window.innerHeight * s.pinRatio);
      return {
        top,
        height: rect.height,
        triggerTop: top,
        triggerHeight,
      };
    });
    dirty = true;
  }

  function computeState(): StepState {
    const y = window.scrollY;
    const viewport = window.innerHeight;
    // 判定线放在视口中部：内容到达视线中心时才算进入这一步
    const line = y + viewport * 0.5;

    let index = 0;
    for (let i = 0; i < ranges.length; i += 1) {
      const r = ranges[i];
      if (line >= r.triggerTop) index = i;
      else break;
    }

    const r = ranges[index];
    const progress = r ? clamp01((line - r.triggerTop) / r.triggerHeight) : 0;
    const direction: 1 | -1 | 0 =
      y > lastScrollY + 0.5 ? 1 : y < lastScrollY - 0.5 ? -1 : 0;

    return { index, id: steps[index]?.id ?? '', progress, direction };
  }

  function update(): boolean {
    if (dirty) {
      // 首次或尺寸变化后强制重算
      lastScrollY = window.scrollY;
      dirty = false;
    }
    const next = computeState();
    const changed =
      next.index !== state.index ||
      Math.abs(next.progress - state.progress) > 0.0005 ||
      next.direction !== state.direction;
    if (changed) {
      state = next;
      for (const fn of listeners) fn(state);
    }
    lastScrollY = window.scrollY;
    return changed;
  }

  // 用 IntersectionObserver 触发一次重算，避免在滚动中每次读取布局。
  const io = new IntersectionObserver(
    () => {
      dirty = true;
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1] }
  );
  for (const s of steps) io.observe(s.el);

  const onResize = () => measure();
  window.addEventListener('resize', onResize);

  // 字体载入与图片解码会改变布局，这两种情况都要重新测量
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => measure());
  }

  measure();

  return {
    onStep(fn: StepListener) {
      listeners.add(fn);
      fn(state);
    },
    update,
    get state() {
      return state;
    },
    goTo(id: string) {
      const i = steps.findIndex((s) => s.id === id);
      if (i < 0) return;
      const r = ranges[i];
      if (!r) return;
      window.scrollTo({ top: r.triggerTop - window.innerHeight * 0.5, behavior: 'smooth' });
    },
    dispose() {
      io.disconnect();
      window.removeEventListener('resize', onResize);
      listeners.clear();
    },
  };
}
