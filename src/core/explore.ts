/**
 * 自由探索模式。
 *
 * 与叙事模式的分工：
 *   叙事模式回答「这片碎片带是怎么来的」，路径由作者排好；
 *   自由探索把同一份点云交给读者，让他在一屏里自己筛类别、高度、年份、
 *   碎片群与时间，并直接转动、缩放这个球。
 *
 * 为什么筛选面板不放进图例：
 *   图例是「画面上的颜色是什么」的说明，常驻且随章节换编码；
 *   探索面板是操作台，只在探索模式下出现，两者混在一起会让读者在叙事模式里
 *   看到一堆与当前画面无关的控件。模式切换由页眉中间的导航承担。
 *
 * 为什么所有筛选都落回 PointLayer 的 uniform：
 *   点云在 GPU 上，筛选只改常量，不重传三万个顶点。面板每动一次，
 *   主循环把状态翻译成 uniform，画面在同一帧响应。
 */

import { el } from './instrument';

export interface ExploreFilters {
  /** 编目点云是否显示 */
  catalogVisible: boolean;
  /** 碎片点云是否显示 */
  debrisVisible: boolean;
  /** 选中的对象类别（0-4）。全选 = 不筛 */
  categories: Set<number>;
  /** 近地点高度带；null = 不限 */
  band: { lo: number; hi: number } | null;
  /** 发射年上限；null = 不限 */
  yearMax: number | null;
  /** 选中的碎片群 id。全选 = 不筛 */
  groups: Set<number>;
  /** 时间推进年数（0-200），只作用于碎片层 */
  horizonYears: number;
}

export interface ExploreCounts {
  catalog: number;
  debris: number;
}

export interface ExploreCategoryRow {
  cat: number;
  label: string;
  color: string;
  count: number;
}

export interface ExploreGroupRow {
  id: number;
  label: string;
  color: string;
  count: number;
}

export interface ExploreOptions {
  /** 发射年滑块的量程（数据里的首末年份） */
  years: { min: number; max: number };
  categoryRows: ExploreCategoryRow[];
  groupRows: ExploreGroupRow[];
  /** 高度档，直接用叙事里那六层，口径与正文一致 */
  bands: { label: string; lo: number; hi: number }[];
  /** 按当前筛选统计「画面里还有多少」，由主循环用原始数组算 */
  counts: (f: ExploreFilters) => ExploreCounts;
  /** 把筛选落到图层与镜头上 */
  apply: (f: ExploreFilters) => void;
  /** 视角按钮 */
  zoom: (factor: number) => void;
  resetView: () => void;
  setSpin: (on: boolean) => void;
  /** 面板高度变化后通知主循环重算标注避让 */
  onResize?: () => void;
}

export interface Explore {
  readonly active: boolean;
  open(): void;
  close(): void;
  /** 自动化校验用：当前筛选的只读快照 */
  state(): ExploreFilters & ExploreCounts;
  /** 重新把当前筛选落到图层（进入模式时主循环会先归零图层） */
  reapply(): void;
  /** 面板矩形，标注层避让用 */
  panelRect(): { left: number; top: number; right: number; bottom: number } | null;
}

const HORIZON_MAX = 200;

export function createExplore(opts: ExploreOptions): Explore {
  const { categoryRows, groupRows, bands } = opts;

  /** 当前筛选。每次打开都从这一刻的状态继续，读者来回切模式不会丢设置。 */
  const filters: ExploreFilters = {
    catalogVisible: true,
    debrisVisible: true,
    categories: new Set(categoryRows.map((c) => c.cat)),
    band: null,
    yearMax: null,
    groups: new Set(groupRows.map((g) => g.id)),
    horizonYears: 0,
  };

  const root = el('div', 'explore-panel');
  root.id = 'explore-panel';
  root.hidden = true;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '自由探索筛选面板');

  // ---------- 头部 ----------
  const head = el('div', 'explore-head');
  const title = el('span', 'explore-title mono', '自由探索');
  const foldBtn = el('button', 'explore-fold mono', '收起');
  foldBtn.type = 'button';
  foldBtn.setAttribute('aria-expanded', 'true');
  head.append(title, foldBtn);

  const body = el('div', 'explore-body');

  // ---------- 视角 ----------
  const viewSec = section('视角');
  const viewRow = el('div', 'explore-view-row');
  const zoomIn = smallBtn('放大 +', '拉近视角');
  const zoomOut = smallBtn('缩小 −', '拉远视角');
  const resetBtn = smallBtn('复位', '回到全景机位');
  const spinLabel = el('label', 'explore-check');
  const spinInput = document.createElement('input');
  spinInput.type = 'checkbox';
  spinInput.checked = true;
  spinLabel.append(spinInput, document.createTextNode('自转'));
  viewRow.append(zoomIn, zoomOut, resetBtn, spinLabel);
  const viewHint = el('p', 'explore-hint', '拖拽旋转 · 滚轮缩放 · 双击复位');
  viewSec.append(viewRow, viewHint);

  // ---------- 图层 ----------
  const layerSec = section('显示图层');
  const catalogCheck = checkRow('编目点云', '编目里有公开轨道根数、能被逐一定位的对象');
  const debrisCheck = checkRow('碎片点云', '三次解体/相撞事件产生的碎片');
  layerSec.append(catalogCheck.label, debrisCheck.label);

  // ---------- 类别 ----------
  const catSec = section('对象类别');
  const catHost = el('div', 'explore-chips');
  const catButtons = new Map<number, HTMLButtonElement>();
  for (const row of categoryRows) {
    const b = el('button', 'explore-chip mono');
    b.type = 'button';
    b.dataset.active = 'true';
    b.setAttribute('aria-pressed', 'true');
    b.title = `${row.label}：${row.count.toLocaleString()} 个可定位对象`;
    const dot = el('span', 'explore-dot');
    dot.style.background = row.color;
    const name = el('span', 'explore-chip-label', row.label);
    const num = el('span', 'explore-chip-num', row.count.toLocaleString());
    b.append(dot, name, num);
    b.addEventListener('click', () => {
      if (filters.categories.has(row.cat)) filters.categories.delete(row.cat);
      else filters.categories.add(row.cat);
      paintCategories();
      commit();
    });
    catButtons.set(row.cat, b);
    catHost.append(b);
  }
  const catHint = el('p', 'explore-hint', '不选 = 只看别的类别；全部关掉 = 编目层不可见。');
  catSec.append(catHost, catHint);

  // ---------- 高度 ----------
  const bandSec = section('近地点高度');
  const bandSelect = document.createElement('select');
  bandSelect.className = 'explore-select mono';
  const allOpt = new Option('全部高度', '');
  bandSelect.append(allOpt);
  for (const b of bands) {
    bandSelect.append(new Option(b.label, `${b.lo}:${b.hi}`));
  }
  bandSelect.addEventListener('change', () => {
    const v = bandSelect.value;
    if (!v) filters.band = null;
    else {
      const [lo, hi] = v.split(':').map(Number);
      filters.band = { lo, hi };
    }
    commit();
  });
  bandSec.append(bandSelect);

  // ---------- 年份 ----------
  const yearSec = section('发射年份');
  const yearHead = el('div', 'explore-slider-head');
  const yearLabel = el('span', 'explore-value mono', '全部年份');
  yearHead.append(yearLabel);
  const yearInput = document.createElement('input');
  yearInput.type = 'range';
  yearInput.className = 'explore-range';
  yearInput.min = String(opts.years.min);
  yearInput.max = String(opts.years.max);
  yearInput.step = '1';
  yearInput.value = String(opts.years.max);
  yearInput.addEventListener('input', () => {
    const v = Number(yearInput.value);
    filters.yearMax = v >= opts.years.max ? null : v;
    paintYear();
    commit();
  });
  const yearScale = el('div', 'explore-scale mono');
  yearScale.append(
    el('span', '', String(opts.years.min)),
    el('span', '', String(opts.years.max))
  );
  yearSec.append(yearHead, yearInput, yearScale);

  // ---------- 碎片群 ----------
  const groupSec = section('碎片群');
  const groupHost = el('div', 'explore-chips');
  const groupButtons = new Map<number, HTMLButtonElement>();
  for (const row of groupRows) {
    const b = el('button', 'explore-chip mono');
    b.type = 'button';
    b.dataset.active = 'true';
    b.setAttribute('aria-pressed', 'true');
    b.title = `${row.label}：${row.count.toLocaleString()} 个碎片`;
    const dot = el('span', 'explore-dot');
    dot.style.background = row.color;
    const name = el('span', 'explore-chip-label', row.label);
    const num = el('span', 'explore-chip-num', row.count.toLocaleString());
    b.append(dot, name, num);
    b.addEventListener('click', () => {
      if (filters.groups.has(row.id)) filters.groups.delete(row.id);
      else filters.groups.add(row.id);
      paintGroups();
      commit();
    });
    groupButtons.set(row.id, b);
    groupHost.append(b);
  }
  const groupHint = el('p', 'explore-hint', '三次事件各一个群，可任意组合。');
  groupSec.append(groupHost, groupHint);

  // ---------- 时间 ----------
  const timeSec = section('时间推进');
  const timeHead = el('div', 'explore-slider-head');
  const timeLabel = el('span', 'explore-value mono', '现在');
  timeHead.append(timeLabel);
  const timeInput = document.createElement('input');
  timeInput.type = 'range';
  timeInput.className = 'explore-range';
  timeInput.min = '0';
  timeInput.max = String(HORIZON_MAX);
  timeInput.step = '1';
  timeInput.value = '0';
  timeInput.addEventListener('input', () => {
    filters.horizonYears = Number(timeInput.value);
    paintTime();
    commit();
  });
  const timeScale = el('div', 'explore-scale mono');
  timeScale.append(el('span', '', '现在'), el('span', '', `${HORIZON_MAX} 年后`));
  const timeHint = el(
    'p',
    'explore-hint',
    '按实测衰减外推：低轨几年就清空，800 公里以上几乎不动。'
  );
  timeSec.append(timeHead, timeInput, timeScale, timeHint);

  // ---------- 底部 ----------
  const foot = el('div', 'explore-foot');
  const clearBtn = smallBtn('重置全部筛选', '恢复默认：全部类别、全部高度、全部年份');
  const countLine = el('p', 'explore-count mono', '-');
  foot.append(clearBtn, countLine);

  body.append(viewSec, layerSec, catSec, bandSec, yearSec, groupSec, timeSec);
  // 计数与「重置全部筛选」钉在面板底部：正文区自己滚动，筛选结果
  // 始终留在视野里，不必把面板拖到底才能看到「还剩多少」。
  root.append(head, body, foot);
  document.body.append(root);

  // ---------- 行为 ----------
  function section(name: string): HTMLElement {
    const sec = el('section', 'explore-sec');
    const h = el('h3', 'explore-sec-title mono', name);
    sec.append(h);
    return sec;
  }

  function smallBtn(label: string, title: string): HTMLButtonElement {
    const b = el('button', 'explore-btn mono', label);
    b.type = 'button';
    b.title = title;
    return b;
  }

  function checkRow(label: string, title: string): {
    label: HTMLLabelElement;
    input: HTMLInputElement;
  } {
    const wrap = el('label', 'explore-check explore-check-row');
    wrap.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    wrap.append(input, document.createTextNode(label));
    return { label: wrap, input };
  }

  function paintCategories(): void {
    for (const [cat, b] of catButtons) {
      const on = filters.categories.has(cat);
      b.dataset.active = String(on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  function paintGroups(): void {
    for (const [id, b] of groupButtons) {
      const on = filters.groups.has(id);
      b.dataset.active = String(on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  function paintYear(): void {
    yearLabel.textContent =
      filters.yearMax === null ? '全部年份' : `≤ ${filters.yearMax} 年`;
  }

  function paintTime(): void {
    timeLabel.textContent =
      filters.horizonYears === 0 ? '现在' : `第 ${filters.horizonYears} 年`;
  }

  function paintCounts(): void {
    const c = opts.counts(filters);
    const total = c.catalog + c.debris;
    countLine.textContent = total === 0
      ? '画面里没有符合条件对象'
      : `画面中 ${c.catalog.toLocaleString()} 个编目对象 · ${c.debris.toLocaleString()} 个碎片`;
  }

  function commit(): void {
    opts.apply(filters);
    paintCounts();
  }

  function setFolded(v: boolean): void {
    root.dataset.folded = String(v);
    foldBtn.textContent = v ? '筛选' : '收起';
    foldBtn.setAttribute('aria-expanded', String(!v));
    opts.onResize?.();
  }

  foldBtn.addEventListener('click', () => setFolded(root.dataset.folded !== 'true'));

  zoomIn.addEventListener('click', () => opts.zoom(0.78));
  zoomOut.addEventListener('click', () => opts.zoom(1.28));
  resetBtn.addEventListener('click', () => opts.resetView());
  spinInput.addEventListener('change', () => opts.setSpin(spinInput.checked));

  catalogCheck.input.addEventListener('change', () => {
    filters.catalogVisible = catalogCheck.input.checked;
    commit();
  });
  debrisCheck.input.addEventListener('change', () => {
    filters.debrisVisible = debrisCheck.input.checked;
    commit();
  });

  clearBtn.addEventListener('click', () => {
    filters.catalogVisible = true;
    filters.debrisVisible = true;
    filters.categories = new Set(categoryRows.map((c) => c.cat));
    filters.band = null;
    filters.yearMax = null;
    filters.groups = new Set(groupRows.map((g) => g.id));
    filters.horizonYears = 0;
    catalogCheck.input.checked = true;
    debrisCheck.input.checked = true;
    bandSelect.value = '';
    yearInput.value = String(opts.years.max);
    timeInput.value = '0';
    paintCategories();
    paintGroups();
    paintYear();
    paintTime();
    commit();
  });

  let active = false;

  return {
    get active() {
      return active;
    },
    open() {
      if (active) return;
      active = true;
      root.hidden = false;
      // 打开时按内存里的筛选重放一次，图层与面板永远一致。
      paintCategories();
      paintGroups();
      paintYear();
      paintTime();
      commit();
      opts.onResize?.();
      // 面板显隐由本模块负责；body 类、相机与叙事层退场由主循环处理，
      // 用事件把两件事接起来，避免本模块反向依赖主循环。
      window.dispatchEvent(new CustomEvent('orbit:explore-toggle', { detail: { on: true } }));
    },
    close() {
      if (!active) return;
      active = false;
      root.hidden = true;
      opts.onResize?.();
      window.dispatchEvent(new CustomEvent('orbit:explore-toggle', { detail: { on: false } }));
    },
    reapply() {
      paintCategories();
      paintGroups();
      paintYear();
      paintTime();
      commit();
      opts.onResize?.();
    },
    state() {
      const c = opts.counts(filters);
      return {
        ...filters,
        categories: new Set(filters.categories),
        groups: new Set(filters.groups),
        catalog: c.catalog,
        debris: c.debris,
      };
    },
    panelRect() {
      if (!active) return null;
      const r = root.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    },
  };
}
