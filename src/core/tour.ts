/**
 * 讲解模式：为答辩现场准备的一条「自动巡游」路线。
 *
 * 为什么需要它：
 *   评审现场通常只有几分钟。19 个滚动步骤里，真正承担论证的是其中八处；
 *   让评委自己滚，很容易停在过渡段，或者错过第二章的两个台阶。
 *   讲解模式把八个关键画面串成一条带字幕的自动路线，按一次就开始，
 *   每 7 秒推进一格，讲述者可以随时暂停、回退或在任意一页接手。
 *
 * 为什么它不复制一遍文案：
 *   每一步仍然跳回原来的叙事步骤，镜头、筛选、仪器、标注全部走既有通路，
 *   讲解条只是压在最上面的一行字幕。这样「讲解模式里看到的」与
 *   「自己滚动看到的」永远是同一个画面，不会出现两套内容需要同步维护。
 *
 * 为什么默认自动推进、但允许暂停：
 *   答辩时讲述者要说话，7 秒只是一个节拍器。按空格即停，
 *   再按继续；按 Esc 退出后页面停在当前章节，读者可以接着自由浏览。
 */

import { el } from './instrument';

export interface TourStep {
  /** 对应叙事步骤的 id（与 #step-<id> 一致） */
  id: string;
  /** 字幕标题，一行 */
  title: string;
  /** 字幕说明，最多两行 */
  note: string;
}

export interface TourOptions {
  steps: TourStep[];
  /** 跳到某个叙事步骤。由主循环注入 story.goTo */
  goTo: (id: string) => void;
  /** 进入讲解模式：主循环据此收起读数卡、关闭对照 */
  onOpen?: () => void;
  /** 退出讲解模式 */
  onClose?: () => void;
}

export interface Tour {
  readonly active: boolean;
  /** 当前讲解步骤下标（未激活时为 -1） */
  readonly index: number;
  open(): void;
  close(): void;
}

/** 每一步停留时长。7 秒大约是一句半讲解词的长度。 */
const DWELL_MS = 7000;

export function createTour(opts: TourOptions): Tour {
  const { steps, goTo } = opts;

  const root = el('div', 'tour-bar');
  root.hidden = true;
  // 让字幕条本身可获得焦点，打开时把焦点放在这里：
  // 空格是暂停，方向键是切换，焦点若落在某个按钮上，空格会改成激活按钮。
  root.tabIndex = -1;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '讲解模式控制条');

  const head = el('div', 'tour-head');
  const counter = el('span', 'tour-counter mono', '01 / 08');
  const title = el('span', 'tour-title');
  const exitBtn = el('button', 'tour-btn tour-exit mono', '退出 Esc');
  exitBtn.type = 'button';
  head.append(counter, title, exitBtn);

  const note = el('p', 'tour-note');
  const foot = el('div', 'tour-foot');
  const prevBtn = el('button', 'tour-btn mono', '‹ 上一步');
  prevBtn.type = 'button';
  const playBtn = el('button', 'tour-btn tour-play mono', '暂停');
  playBtn.type = 'button';
  const nextBtn = el('button', 'tour-btn mono', '下一步 ›');
  nextBtn.type = 'button';
  const progress = el('div', 'tour-progress');
  const dots: HTMLElement[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const dot = el('span', 'tour-dot');
    dot.setAttribute('aria-hidden', 'true');
    dots.push(dot);
    progress.append(dot);
  }
  foot.append(prevBtn, playBtn, nextBtn, progress);
  root.append(head, note, foot);
  document.body.append(root);

  let active = false;
  let index = 0;
  let paused = false;
  let timer = 0;
  let reducedMotion: MediaQueryList | null = null;

  function resetTimer() {
    window.clearTimeout(timer);
    timer = 0;
    if (!active || paused) return;
    timer = window.setTimeout(() => go(1, 'auto'), DWELL_MS);
  }

  function paint() {
    const s = steps[index];
    if (!s) return;
    counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`;
    title.textContent = s.title;
    note.textContent = s.note;
    playBtn.textContent = paused ? '继续' : '暂停';
    playBtn.setAttribute('aria-pressed', String(paused));
    dots.forEach((d, i) => {
      d.dataset.state = i < index ? 'past' : i === index ? 'active' : 'idle';
    });
    root.dataset.paused = String(paused);
  }

  function go(delta: number, reason: 'auto' | 'user') {
    if (!active) return;
    const next = index + delta;
    if (next >= steps.length) {
      // 走到最后一步就停在原地，不自动退出：讲述者往往要在结论页多说几句。
      if (reason === 'auto') {
        paused = true;
        paint();
        resetTimer();
      }
      return;
    }
    if (next < 0) return;
    index = next;
    goTo(steps[index].id);
    paint();
    resetTimer();
  }

  function open() {
    if (active || !steps.length) return;
    active = true;
    index = 0;
    paused = false;
    root.hidden = false;
    document.body.classList.add('is-touring');
    // 减少动态效果的用户不想要「页面自己在动」：进来就停住，
    // 由讲述者按「下一步」推进。
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) paused = true;
    paint();
    // 先让主循环按新的 body 类重排一次（正文要给字幕条让出底部空间），
    // 再跳第一步。顺序反了的话，第一次跳转用的是旧布局量出的滚动区间。
    opts.onOpen?.();
    goTo(steps[0].id);
    resetTimer();
    root.focus({ preventScroll: true });
  }

  function close() {
    if (!active) return;
    active = false;
    window.clearTimeout(timer);
    timer = 0;
    root.hidden = true;
    document.body.classList.remove('is-touring');
    opts.onClose?.();
  }

  function togglePause() {
    if (!active) return;
    paused = !paused;
    paint();
    resetTimer();
  }

  /**
   * 读者自己滚动就暂停。
   *
   * 讲解模式每 7 秒把页面拉回路线上的下一格；如果讲述者顺手滚了一下，
   * 继续自动跳会把人拽走。滚轮与触摸是「我要自己看」的明确信号，
   * 收到就停住，按「继续」再恢复。
   */
  const onManualScroll = () => {
    if (!active || paused) return;
    paused = true;
    paint();
    resetTimer();
  };
  window.addEventListener('wheel', onManualScroll, { passive: true });
  window.addEventListener('touchmove', onManualScroll, { passive: true });

  exitBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', () => {
    // 手动回退时如果原本在自动播放，保持播放状态，但把计时重新开始。
    if (paused) paused = false;
    go(-1, 'user');
  });
  nextBtn.addEventListener('click', () => go(1, 'user'));
  playBtn.addEventListener('click', togglePause);

  window.addEventListener(
    'keydown',
    (e) => {
      if (!active) return;
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          close();
          break;
        case 'ArrowRight':
          e.preventDefault();
          e.stopPropagation();
          go(1, 'user');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          e.stopPropagation();
          go(-1, 'user');
          break;
        case ' ':
          // 焦点在按钮上时，空格应该激活按钮而不是再切换一次暂停。
          // 合成事件的 target 可能不是 Element，先判断再调用 closest。
          if (e.target instanceof Element && e.target.closest('button')) return;
          e.preventDefault();
          e.stopPropagation();
          togglePause();
          break;
        default:
          break;
      }
    },
    true
  );

  return {
    get active() {
      return active;
    },
    get index() {
      return active ? index : -1;
    },
    open,
    close,
  };
}
