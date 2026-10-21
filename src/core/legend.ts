/**
 * 筛选回显条。
 *
 * 以前这里是一张常驻的图例卡：标题、五类对象、两个演示模式按钮。
 * 它承担了三件事，现在三件事各有更合适的位置：
 *   - 颜色说明：右栏仪器每一行前面就有同色色点，探索面板的类别 chip 也带色点；
 *   - 时间对照：已并入自由探索，不再需要一个独立的全屏模式；
 *   - 讲解：页眉的模式导航已经常驻。
 * 于是这张卡在叙事模式里只剩下遮挡正文的副作用（实测开场 h1 被压在卡片下面），
 * 因此删掉，只保留「当前筛了什么」这一件真正需要常驻的信息。
 *
 * 为什么回显条只在有筛选时出现：
 *   没有筛选时它没有任何信息量，却会和正文抢左上角；有筛选时读者又必须知道
 *   「画面为什么变少了」。所以它默认不存在，一旦用户点了仪器或图例行才浮出来，
 *   并且停在视口底部中央，不压标题与首段。
 */

import type { Figures } from '../content/figures';
import type { InstrumentIntent } from './instrument';
import { el } from './instrument';

export interface LegendPayload {
  step: string;
  figures: Figures;
  catalogVisible: boolean;
  debrisVisible: boolean;
  categoryMix: number;
  debrisGroups: { lo: number; hi: number } | null;
  yearMax: number | null;
  category: number | null;
  group: number | null;
  band: { lo: number; hi: number | null } | null;
  bin: { lo: number; hi: number } | null;
  horizonYears: number;
}

export interface LegendHost {
  update(p: LegendPayload): void;
  /** 尾页静音 */
  setMuted(v: boolean): void;
  /** 兼容旧调用：模式高亮已移除，保留空实现避免调用点分叉 */
  setMode(mode: 'compare' | 'tour' | null): void;
  visibleRect(): { left: number; top: number; right: number; bottom: number } | null;
}

const CAT_LABEL = ['工作中的载荷', '已停摆的载荷', '火箭残骸', '碎片', '未分类'];

export function createLegend(host: HTMLElement, emit: (i: InstrumentIntent) => void): LegendHost {
  const root = el('div', 'filterbar');
  root.id = 'scene-filterbar';
  root.hidden = true;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const chipsHost = el('div', 'filterbar-chips');
  const clearAll = el('button', 'filterbar-clear mono', '清除');
  clearAll.type = 'button';
  clearAll.title = '清除全部筛选，回到当前章节的默认画面';
  clearAll.addEventListener('click', () => emit({ kind: 'reset' }));
  root.append(el('span', 'filterbar-title mono', '当前筛选'), chipsHost, clearAll);
  host.append(root);

  let muted = false;
  let lastKey = '';

  function build(p: LegendPayload): { text: string; clear?: () => void }[] {
    const chips: { text: string; clear?: () => void }[] = [];
    if (p.yearMax !== null) chips.push({ text: `时间 ≤ ${p.yearMax}` });
    if (p.category !== null) {
      chips.push({
        text: `只看 ${CAT_LABEL[p.category] ?? '类别'}`,
        clear: () => emit({ kind: 'reset' }),
      });
    }
    if (p.band) {
      const hi = p.band.hi === null ? ' 以上' : `–${p.band.hi} km`;
      chips.push({
        text: `高度 ${p.band.lo}${hi}`,
        clear: () => emit({ kind: 'reset' }),
      });
    }
    if (p.group !== null) {
      const g = p.figures.debris[p.group];
      chips.push({
        text: `只看 ${g?.label ?? '碎片群'}`,
        clear: () => emit({ kind: 'reset' }),
      });
    }
    if (p.bin) {
      chips.push({
        text: `近地点 ${p.bin.lo}–${p.bin.hi} km`,
        clear: () => emit({ kind: 'reset' }),
      });
    }
    if (p.horizonYears > 0) {
      chips.push({
        text: `推到第 ${p.horizonYears} 年`,
        clear: () => emit({ kind: 'horizon', years: 0 }),
      });
    }
    return chips;
  }

  return {
    update(p) {
      const chips = build(p);
      const key = `${muted}|${chips.map((c) => c.text).join('|')}`;
      if (key === lastKey) return;
      lastKey = key;
      root.hidden = muted || chips.length === 0;
      chipsHost.replaceChildren();
      for (const c of chips) {
        const chip = el('span', 'filterbar-chip');
        chip.append(el('span', 'filterbar-chip-text mono', c.text));
        if (c.clear) {
          const x = el('button', 'filterbar-x', '×');
          x.type = 'button';
          x.setAttribute('aria-label', `清除筛选：${c.text}`);
          x.addEventListener('click', c.clear);
          chip.append(x);
        }
        chipsHost.append(chip);
      }
    },
    setMuted(v) {
      muted = v;
      if (v) root.hidden = true;
      lastKey = '';
    },
    setMode() {
      /* 模式高亮已并入页眉导航，这里不再有视觉状态 */
    },
    visibleRect() {
      if (muted || root.hidden) return null;
      const r = root.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    },
  };
}
