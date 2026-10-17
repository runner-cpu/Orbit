/**
 * 把叙事栏里的数字块变成可以直接操作球体的控件。
 *
 * 为什么需要这一层：
 *   左栏原本全是「标签 + 数字」的静态行，读者只能读、不能动；
 *   能动的只有右栏那块面板。可在手机上右栏被压到屏幕底部，
 *   读者的手指自然先落到正文上。把正文里的条形、图例、年份条也接上
 *   球体之后，整页的控制面从一块面板扩展到整栏。
 *
 * 交互约定（与右栏仪器保持一致）：
 *   指针移入 = 预览，移出 = 还原，点击 = 锁定，再点一次 = 取消。
 *   预览只在没有锁定时生效，否则悬停会把读者刚锁定的筛选冲掉。
 *
 * 声明方式：内容层给元素加 data-globe="kind:a:b"，这里解析成
 * InstrumentIntent 抛给场景层。文案层因此不需要知道 PointLayer 的存在，
 * 也不需要 import 任何三维模块。
 */

import type { InstrumentIntent } from './instrument';

/** data-globe 的取值 → 意图。解析失败返回 null（该行保持静态）。 */
export function parseGlobeSpec(spec: string): InstrumentIntent | null {
  const [kind, a, b] = spec.split(':');
  const na = Number(a);
  const nb = b === undefined || b === '' ? null : Number(b);

  switch (kind) {
    case 'category':
      return Number.isFinite(na) ? { kind: 'category', category: na } : null;
    case 'band':
      return Number.isFinite(na) ? { kind: 'altitude-band', lo: na, hi: nb } : null;
    case 'year':
      return Number.isFinite(na) ? { kind: 'year', year: na } : null;
    case 'group':
      return Number.isFinite(na) ? { kind: 'debris-group', group: na } : null;
    case 'bin':
      return Number.isFinite(na) && nb !== null && Number.isFinite(nb)
        ? { kind: 'perigee-bin', lo: na, hi: nb }
        : null;
    case 'horizon':
      return Number.isFinite(na) ? { kind: 'horizon', years: na } : null;
    default:
      return null;
  }
}

export interface RailControlOptions {
  /** 当前正在阅读的步骤元素。只有它的控件响应，屏幕外的步骤不抢输入。 */
  activeStep(): HTMLElement | null;
  /** 点击锁定 / 解除。intent 为 null 表示解除。 */
  lock(intent: InstrumentIntent | null): void;
  /** 悬停预览 / 结束预览。intent 为 null 表示还原。 */
  preview(intent: InstrumentIntent | null): void;
  /** 是否有别的入口已经锁定了筛选。为真时预览不生效。 */
  hasLock(): boolean;
  /**
   * 页面是否刚在滚动。
   *
   * 浏览器在元素被滚动带过指针下方时也会补发 pointerenter。
   * 不加这道闸，读者用滚轮往下翻，一行行条形从指针底下路过，
   * 每过一行球就被筛一次 —— 看起来像画面在自己抽搐。
   */
  isScrolling(): boolean;
}

/**
 * 给一页里所有 data-globe 元素接上交互。
 *
 * 同一组里同时只能锁定一行：点第二行会把第一行的锁定标记清掉，
 * 否则界面上会出现两行「已锁定」而球只认最后一个。
 *
 * 返回 reset()：切到别的章节时调用，把残留的锁定标记与筛选一起清掉。
 */
export function mountRailControls(
  steps: HTMLElement[],
  opts: RailControlOptions
): { reset: () => void } {
  const all: HTMLElement[] = [];

  for (const step of steps) {
    const nodes = [...step.querySelectorAll<HTMLElement>('[data-globe]')];
    all.push(...nodes);
    for (const node of nodes) {
      const intent = parseGlobeSpec(node.dataset.globe ?? '');
      if (!intent) continue;

      node.classList.add('is-control');
      node.tabIndex = 0;
      node.setAttribute('role', 'button');

      const active = () => opts.activeStep() === step;

      const enter = () => {
        if (!active() || opts.hasLock() || opts.isScrolling()) return;
        if (node.dataset.locked === 'true') return;
        opts.preview(intent);
      };
      const leave = () => {
        if (!active() || node.dataset.locked === 'true') return;
        opts.preview(null);
      };

      node.addEventListener('pointerenter', enter);
      node.addEventListener('pointerleave', leave);
      node.addEventListener('focus', enter);
      node.addEventListener('blur', leave);

      node.addEventListener('click', () => {
        if (!active()) return;
        const wasLocked = node.dataset.locked === 'true';
        for (const other of nodes) other.dataset.locked = 'false';
        if (wasLocked) {
          opts.lock(null);
          return;
        }
        node.dataset.locked = 'true';
        opts.lock(intent);
      });

      node.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        node.click();
      });
    }
  }

  return {
    reset() {
      let had = false;
      for (const node of all) {
        if (node.dataset.locked === 'true') had = true;
        node.dataset.locked = 'false';
      }
      if (had) opts.lock(null);
    },
  };
}
