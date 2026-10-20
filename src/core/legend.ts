/**
 * 常驻编码图例与筛选回显。
 *
 * 为什么需要它：
 *   作品用颜色编码数据：编目点按对象类别上色，碎片按所属事件上色，
 *   第二章的时间切片还有一层「已出现 / 尚未出现」的明暗差异。
 *   在加这块图例之前，颜色的含义只散落在右栏仪器的行首色点里，
 *   读者把视线移回球面时已经记不住哪个颜色对应哪一类；评委第一次打开
 *   页面时更无从判断「橙色到底是什么」。数据可视化里，视觉编码没有图例
 *   等于没有编码。
 *
 * 为什么把图例做成可点的：
 *   图例只写「橙色 = 碎片」仍然只是说明。让它同时是筛选入口，
 *   读者可以就地验证这句话：点一下，球上只剩橙色。同一块区域先给编码、
 *   再给操作，比在正文里写一句「点右栏可以筛选」短得多。
 *
 * 为什么还要回显筛选：
 *   筛选全部发生在着色器的 uniform 上，被筛掉的点不会减少 draw call，
 *   画面之外没有任何痕迹说明「现在只看 750-800 公里」。读者滚到下一段
 *   发现点变少了，会以为是渲染出错。回显条把当前生效的条件写出来，
 *   并给一次清除的入口。
 */

import type { Figures } from '../content/figures';
import type { InstrumentIntent } from './instrument';
import { el } from './instrument';

export interface LegendPayload {
  /** 当前叙事步骤标识，用于复制链接 */
  step: string;
  figures: Figures;
  catalogVisible: boolean;
  debrisVisible: boolean;
  categoryMix: number;
  debrisGroups: { lo: number; hi: number } | null;
  yearMax: number | null;
  /** 用户锁定的类别（null = 跟随场景） */
  category: number | null;
  /** 用户锁定的碎片群 */
  group: number | null;
  /** 用户锁定的高度区间 */
  band: { lo: number; hi: number | null } | null;
  /** 用户锁定的近地点档 */
  bin: { lo: number; hi: number } | null;
  /** 当前时间推进年数（0 = 现在） */
  horizonYears: number;
}

export interface LegendHost {
  update(p: LegendPayload): void;
  /** 尾页静音 */
  setMuted(v: boolean): void;
  /** 高亮当前正在运行的演示模式（对照 / 讲解），null = 都没有 */
  setMode(mode: 'compare' | 'tour' | null): void;
  /**
   * 面板当前的屏幕矩形。标注层要绕开它，否则球边缘的标签会压在图例上。
   * 收起或静音时返回 null。
   */
  visibleRect(): { left: number; top: number; right: number; bottom: number } | null;
}

/** 类别号 → 配色与名称，与 pointCloud.ts 的 PALETTE.category 对应。 */
const CAT_ROWS: { cat: number; label: string; color: string }[] = [
  { cat: 0, label: '工作中的载荷', color: '#7ad4f5' },
  { cat: 1, label: '已停摆的载荷', color: '#f0a94c' },
  { cat: 2, label: '火箭残骸', color: '#c98a9e' },
  { cat: 3, label: '碎片', color: '#ff6b35' },
  { cat: 4, label: '未分类', color: '#5a6b78' },
];

/** 碎片群配色，与 scenes.ts 的 DEBRIS_PALETTE 对应。 */
const GROUP_COLORS = ['#ff7a45', '#4fc3f7', '#ffd54f'];

interface Row {
  label: string;
  color: string;
  value?: string;
  /** 可点的行会带上这个意图；不可点的行只是说明 */
  intent?: InstrumentIntent;
  /** 作为「尚未发生」的淡影样式 */
  ghost?: boolean;
}

export function createLegend(host: HTMLElement, emit: (i: InstrumentIntent) => void): LegendHost {
  const root = el('div', 'legend-panel');
  root.id = 'scene-legend';

  const head = el('div', 'legend-head');
  const title = el('span', 'legend-title mono', '图例');
  // 两个「演示模式」入口放在图例头部：回答的是「除了滚动，这一页还能怎么用」。
  // 对照模式与讲解模式都不是筛选，因此不和下面的行混在一起。
  const compareBtn = el('button', 'legend-btn legend-mode-btn mono', '时间对照');
  compareBtn.type = 'button';
  compareBtn.title = '把 2015 年及以前发射、今天仍可定位的点云与现在放进同一画面，拖动中缝比较';
  const tourBtn = el('button', 'legend-btn legend-mode-btn mono', '讲解');
  tourBtn.type = 'button';
  tourBtn.title = '按八个关键画面自动巡游，适合答辩演示';
  const copyBtn = el('button', 'legend-btn mono', '复制本步链接');
  copyBtn.type = 'button';
  copyBtn.title = '复制带当前章节锚点的链接，答辩时可以直接跳到这一步';
  const foldBtn = el('button', 'legend-btn mono', '收起');
  foldBtn.type = 'button';
  foldBtn.setAttribute('aria-expanded', 'true');
  head.append(title, copyBtn, foldBtn);

  // 演示模式入口单独一行：它们不是筛选，也不该和图例行混在一起。
  // 放在图例下方而不是页眉：页眉还要容纳复制与折叠，四个按钮会挤成一团。
  const modes = el('div', 'legend-modes');
  modes.append(compareBtn, tourBtn);

  const body = el('div', 'legend-body');
  const rowsHost = el('div', 'legend-rows');
  const filterHost = el('div', 'legend-filters');
  body.append(rowsHost, filterHost, modes);
  root.append(head, body);
  host.append(root);

  let muted = false;
  let lastRowsKey = '';
  let lastFilterKey = '';
  let currentStep = '';

  function userFilterCount(p: LegendPayload): number {
    let n = 0;
    if (p.category !== null) n += 1;
    if (p.group !== null) n += 1;
    if (p.band) n += 1;
    if (p.bin) n += 1;
    if (p.horizonYears > 0) n += 1;
    return n;
  }

  /** 当前画面用哪一套颜色编码。 */
  function buildRows(p: LegendPayload): { heading: string; rows: Row[] } {
    // 有时间切片时，编码是「已出现 / 未出现」，不是类别色。
    // 这一步的主语是时间，图例跟着换，读者不会把淡影误读成某一类对象。
    if (p.yearMax !== null) {
      return {
        heading: `时间切片 · ${p.yearMax} 年末`,
        rows: [
          { label: '当年已在轨', color: '#7ad4f5', value: '实心' },
          { label: '之后才发射', color: '#7ad4f5', value: '淡影', ghost: true },
        ],
      };
    }

    const groups = p.figures.debris;
    const visibleGroups = groups.filter((_, i) => {
      if (!p.debrisVisible) return false;
      const range = p.debrisGroups;
      if (p.group !== null) return i === p.group;
      if (!range) return true;
      // 场景表用区间表达群筛选（-0.5 到 0.5 是单群）
      return i >= range.lo && i <= range.hi;
    });

    if (p.debrisVisible && visibleGroups.length > 0 && p.categoryMix < 0.5) {
      return {
        heading:
          visibleGroups.length === 1 ? '画面内 · 一个碎片群' : '画面内 · 碎片群颜色',
        rows: [
          ...visibleGroups.map((g) => {
            const idx = groups.indexOf(g);
            return {
              label: g.label,
              color: GROUP_COLORS[idx] ?? GROUP_COLORS[0],
              value: `${g.count} 个`,
              intent:
                visibleGroups.length > 1
                  ? ({ kind: 'debris-group', group: idx } as InstrumentIntent)
                  : undefined,
            };
          }),
          ...(p.catalogVisible
            ? [{ label: '其余编目对象（背景）', color: '#7ad4f5' } as Row]
            : []),
        ],
      };
    }

    if (p.catalogVisible) {
      return {
        heading: '编目点 · 按对象类别',
        rows: CAT_ROWS.map((c) => {
          const n = p.figures.locatedByCategory.find((x) => x.key === c.cat)?.count ?? 0;
          return {
            label: c.label,
            color: c.color,
            value: `${n} 个`,
            intent: { kind: 'category', category: c.cat } as InstrumentIntent,
          };
        }),
      };
    }

    return {
      heading: '画面内',
      rows: [{ label: '可定位对象', color: '#7ad4f5' }],
    };
  }

  function paintRows(p: LegendPayload) {
    const { heading, rows } = buildRows(p);
    const key = heading + '|' + rows.map((r) => r.label + (r.ghost ? 'g' : '')).join(',');
    if (key === lastRowsKey) {
      // 只更新选中态：颜色映射没变时不必重建 DOM。
      syncActive(p);
      return;
    }
    lastRowsKey = key;
    title.textContent = heading;
    rowsHost.replaceChildren();
    for (const r of rows) {
      const row = el(r.intent ? 'button' : 'div', 'legend-row-s');
      if (r.intent) {
        (row as HTMLButtonElement).type = 'button';
        row.addEventListener('click', () => {
          // 再点一次同一项 = 撤销，和正文里的可点行保持同一套语义
          const same =
            (r.intent!.kind === 'category' && p.category === r.intent!.category) ||
            (r.intent!.kind === 'debris-group' && p.group === r.intent!.group);
          emit(same ? { kind: 'reset' } : r.intent!);
        });
      }
      const sw = el('span', 'legend-sw');
      sw.style.background = r.color;
      if (r.ghost) sw.dataset.ghost = 'true';
      const label = el('span', 'legend-label-s', r.label);
      row.append(sw, label);
      if (r.value) row.append(el('span', 'legend-value-s mono', r.value));
      rowsHost.append(row);
    }
    syncActive(p);
  }

  /** 把用户锁定的项在行上标出来，读者能看出「是我自己点的」。 */
  function syncActive(p: LegendPayload) {
    for (const node of rowsHost.children) {
      const row = node as HTMLElement;
      if (row.tagName !== 'BUTTON') continue;
      const label = row.querySelector('.legend-label-s')?.textContent ?? '';
      const cat = CAT_ROWS.find((c) => c.label === label);
      const groupIdx = p.figures.debris.findIndex((g) => g.label === label);
      row.dataset.active = String(
        (cat !== undefined && p.category === cat.cat) ||
          (groupIdx >= 0 && p.group === groupIdx)
      );
    }
  }

  function paintFilters(p: LegendPayload) {
    const chips: { text: string; clear?: () => void }[] = [];
    if (p.yearMax !== null) {
      chips.push({ text: `时间 ≤ ${p.yearMax}` });
    }
    if (p.category !== null) {
      const label = CAT_ROWS.find((c) => c.cat === p.category)?.label ?? '类别';
      chips.push({ text: `只看 ${label}`, clear: () => emit({ kind: 'reset' }) });
    }
    if (p.band) {
      const hi = p.band.hi === null ? '以上' : `–${p.band.hi} km`;
      chips.push({ text: `高度 ${p.band.lo}${hi}`, clear: () => emit({ kind: 'reset' }) });
    }
    if (p.group !== null) {
      const g = p.figures.debris[p.group];
      chips.push({ text: `只看 ${g?.label ?? '碎片群'}`, clear: () => emit({ kind: 'reset' }) });
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

    const key = chips.map((c) => c.text).join('|');
    if (key === lastFilterKey) return;
    lastFilterKey = key;
    filterHost.replaceChildren();

    if (!chips.length) return;

    for (const c of chips) {
      const chip = el('span', 'filter-chip');
      chip.append(el('span', 'filter-chip-text mono', c.text));
      if (c.clear) {
        const x = el('button', 'filter-clear', '×');
        (x as HTMLButtonElement).type = 'button';
        x.setAttribute('aria-label', `清除筛选：${c.text}`);
        x.addEventListener('click', c.clear);
        chip.append(x);
      }
      filterHost.append(chip);
    }

    const n = userFilterCount(p);
    if (n > 1) {
      const all = el('button', 'filter-all mono', `全部清除 (${n})`);
      all.type = 'button';
      all.addEventListener('click', () => emit({ kind: 'reset' }));
      filterHost.append(all);
    }
  }

  foldBtn.addEventListener('click', () => {
    const folded = root.dataset.folded === 'true';
    root.dataset.folded = String(!folded);
    foldBtn.textContent = folded ? '收起' : '展开';
    foldBtn.setAttribute('aria-expanded', String(folded));
    window.dispatchEvent(new CustomEvent('orbit:legend-resize'));
  });

  compareBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('orbit:compare'));
  });
  tourBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('orbit:tour'));
  });

  copyBtn.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}#${currentStep}`;
    const done = () => {
      copyBtn.textContent = '已复制';
      window.setTimeout(() => (copyBtn.textContent = '复制本步链接'), 1600);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(done).catch(() => fallback());
    } else {
      fallback();
    }
    /** 剪贴板不可用时的退路：选中地址栏里的地址，让读者自己按 Ctrl+C。 */
    function fallback() {
      window.prompt('复制这个链接（Ctrl+C）：', url);
      done();
    }
  });

  return {
    update(p) {
      currentStep = p.step;
      paintRows(p);
      paintFilters(p);
    },
    setMuted(v) {
      muted = v;
      root.dataset.muted = String(v);
    },
    setMode(mode) {
      compareBtn.dataset.active = String(mode === 'compare');
      tourBtn.dataset.active = String(mode === 'tour');
      compareBtn.setAttribute('aria-pressed', String(mode === 'compare'));
      tourBtn.setAttribute('aria-pressed', String(mode === 'tour'));
    },
    visibleRect() {
      if (muted || root.dataset.folded === 'true') return null;
      const r = root.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    },
  };
}
