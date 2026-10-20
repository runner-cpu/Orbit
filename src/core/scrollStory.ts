/**
 * 滚动叙事控制器。
 *
 * 做什么：把页面上若干「叙事节」的滚动位置映射成 0-1 的进度值，
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
  /** 本步内部进度 0-1 */
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
  /** 立即跳转（不带平滑滚动），用于首屏锚点落位 */
  jumpTo(id: string): void;
  /**
   * 重新测量所有步骤的文档区间。
   *
   * 讲解模式会在运行时改变步骤高度（收起折叠块、给窄屏正文让出字幕条），
   * 这些变化不一定会触发 IntersectionObserver。调用方显式重测一次，
   * 否则步骤判定会停在旧的文档坐标上，画面与正文对不上。
   */
  remeasure(): void;
  /** 调试用：各步的文档滚动区间，用于核对锚点落位 */
  debugRanges(): {
    id: string;
    top: number;
    height: number;
    triggerTop: number;
    triggerHeight: number;
  }[];
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
    /** 调试用：当前各步的滚动区间，用于核对锚点落位。 */
    debugRanges() {
      return ranges.map((r, i) => ({
        id: steps[i]?.id ?? '',
        top: Math.round(r.top),
        height: Math.round(r.height),
        triggerTop: Math.round(r.triggerTop),
        triggerHeight: Math.round(r.triggerHeight),
      }));
    },
    goTo(id: string) {
      const i = steps.findIndex((s) => s.id === id);
      if (i < 0) return;
      const r = ranges[i];
      if (!r) return;
      window.scrollTo({ top: Math.max(0, r.triggerTop - window.innerHeight * 0.5), behavior: 'smooth' });
    },
    jumpTo(id: string) {
      const target = steps.findIndex((s) => s.id === id);
      if (target < 0) return;
      let tries = 0;

      /**
       * 反复「跳一次、量一次」，直到真的落在目标步上。
       *
       * 为什么不一次跳到位：窄屏上每一步的高度取决于当前仪器面板的高度
       * （面板排在正文下方，正文要整体让开它），而面板随场景换高换矮。
       * 滚到目标附近之后场景才激活、面板才换高，后面所有步的 offset 跟着变，
       * 刚才算出的落点就失效了。实测只按坐标跳一次，手机端会落在目标步前两步。
       *
       * 所以收敛判据不看坐标，看步骤下标：只要 computeState 认为已经到了
       * 目标步就停。次数有上限，避免面板高度与滚动位置互相推挤时无限追。
       */
      const step = () => {
        tries += 1;
        measure();
        const r = ranges[target];
        if (!r) return;
        // 多走 3 像素：判定线是「滚动量 + 半个视口」，而 scrollY 会被浏览器
        // 舍入到亚像素。恰好落在 triggerTop 上时，算出来的判定线可能比
        // triggerTop 小 0.2 像素，于是停在目标步的前一步。3 像素跨过这条线，
        // 肉眼看不出来，步骤判定却稳定了。
        //
        // 窄屏的落点不一样：正文是底部对齐的（CSS 里 align-items: end），
        // 面板固定在下沿、正文靠 padding 让开它。此时把「步骤顶部」对到
        // 视口中线，会把正文推到面板背后。改成对齐「步骤底部」，正文就
        // 回到它的设计位置——面板上方。桌面端仍是顶部对齐到中线。
        const narrow = window.innerWidth <= 1080;
        const want = narrow
          ? Math.max(0, r.triggerTop + r.height - window.innerHeight)
          : Math.max(0, r.triggerTop - window.innerHeight * 0.5 + 3);
        // 首屏落位必须瞬时完成：html 上开了 scroll-behavior: smooth，
        // 平滑滚动会与「图片/字体载入后重排」竞争，实测落点会偏一屏。
        window.scrollTo({ top: want, behavior: 'instant' });
        // 两个条件要同时成立：步骤下标对，且真的停在了算出来的位置上。
        // 只看下标是不够的：落到目标步区间内的任何一点都算「对数」，
        // 但如果场景切换把后面的步整体推移了，实际位置会差几百像素，
        // 读者打开锚点链接却看不到那一步的正文。
        const settled =
          computeState().index === target && Math.abs(window.scrollY - want) <= 4;
        if (settled || tries > 12) return;
        window.setTimeout(step, 160);
      };

      step();
    },
    dispose() {
      io.disconnect();
      window.removeEventListener('resize', onResize);
      listeners.clear();
    },
    remeasure() {
      measure();
    },
  };
}
