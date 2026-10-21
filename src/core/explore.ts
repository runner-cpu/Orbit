/**
 * 自由探索模式。
 *
 * 与叙事模式的分工：
 *   叙事模式回答「这片碎片带是怎么来的」，路径由作者排好；
 *   自由探索把同一份点云交给读者，让他在一屏里自己筛对象、时间与碎片，
 *   并直接转动、缩放这个球。
 *
 * 为什么分成「编目对象 / 碎片」两个页签：
 *   两类数据的筛选维度并不相同——编目有类别、轨道类型、发射年份，
 *   碎片有事件来源、近地点、倾角与时间推进。把它们平铺在一列里，
 *   读者会误以为「发射年份」也会筛碎片、「碎片群」也会筛编目。
 *   页签把「这组条件作用于哪一层」变成界面本身，而不是靠说明文字。
 *
 * 为什么时间对照放进探索而不是另开一个全屏模式：
 *   对照本来就是一种筛选（左半按参照年截断，右半不截断）。放在探索面板里，
 *   读者可以一边拖参照年、一边叠加类别与高度条件，两半同步变化；
 *   不必退出一个模式再进另一个。
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
  /** 选中的轨道类型。全选 = 不筛 */
  orbits: Set<number>;
  /** 编目近地点区间；null = 不限 */
  band: { lo: number; hi: number } | null;
  /** 发射年下限；null = 不限 */
  yearMin: number | null;
  /** 发射年上限；null = 不限 */
  yearMax: number | null;
  /** 选中的碎片群 id。全选 = 不筛 */
  groups: Set<number>;
  /** 碎片近地点区间；null = 不限 */
  debrisBand: { lo: number; hi: number } | null;
  /** 碎片倾角区间；null = 不限 */
  incl: { lo: number; hi: number } | null;
  /** 时间推进年数（0-200） */
  horizonYears: number;
  /** 是否开启时间对照（只作用于编目层） */
  compare: boolean;
  /** 参照年：左半显示该年及以前发射的对象 */
  compareYear: number;
  /** 中缝位置 0.08-0.92 */
  wipe: number;
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

export interface ExploreOrbitRow {
  code: number;
  label: string;
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
  orbitRows: ExploreOrbitRow[];
  groupRows: ExploreGroupRow[];
  /** 编目高度档，口径与正文一致 */
  bands: { label: string; lo: number; hi: number }[];
  /** 碎片近地点档，按碎片实际分布另分（与编目层不是同一组） */
  debrisBands: { label: string; lo: number; hi: number }[];
  /** 碎片倾角档 */
  inclBands: { label: string; lo: number; hi: number }[];
  /** 时间对照的参照年范围与默认值 */
  compareYears: { min: number; max: number; initial: number };
  /** 按当前筛选统计「画面里还有多少」 */
  counts: (f: ExploreFilters) => ExploreCounts;
  /** 时间对照左半（≤ year）的编目计数，需叠加当前筛选 */
  compareLeftCount: (year: number, f: ExploreFilters) => number;
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
  /** 键盘 C：在探索里开关分屏对照 */
  toggleCompare(): void;
}

const HORIZON_MAX = 200;

export function createExplore(opts: ExploreOptions): Explore {
  const { categoryRows, orbitRows, groupRows, bands, debrisBands, inclBands } = opts;

  /** 当前筛选。每次打开都从这一刻的状态继续，读者来回切模式不会丢设置。 */
  const filters: ExploreFilters = {
    catalogVisible: true,
    debrisVisible: true,
    categories: new Set(categoryRows.map((c) => c.cat)),
    orbits: new Set(orbitRows.map((o) => o.code)),
    band: null,
    yearMin: null,
    yearMax: null,
    groups: new Set(groupRows.map((g) => g.id)),
    debrisBand: null,
    incl: null,
    horizonYears: 0,
    compare: false,
    compareYear: opts.compareYears.initial,
    wipe: 0.5,
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

  // ---------- 视角（压成一行，给筛选让出高度） ----------
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
  const viewSec = section('视角');
  viewSec.append(viewRow, viewHint);

  // ---------- 快速视图 ----------
  const presetSec = section('快速视图');
  const presetHost = el('div', 'explore-presets');
  const PRESETS: { key: string; label: string; title: string; apply: () => void }[] = [
    {
      key: 'all',
      label: '全部',
      title: '不筛任何条件，显示全部编目与碎片',
      apply: () => resetFilters(),
    },
    {
      key: 'payload',
      label: '工作中的载荷',
      title: '只显示仍在正常工作的载荷（编目层）',
      apply: () => {
        filters.catalogVisible = true;
        filters.debrisVisible = false;
        filters.categories = new Set([0]);
        filters.orbits = new Set(orbitRows.map((o) => o.code));
        filters.band = null;
        filters.yearMin = null;
        filters.yearMax = null;
        filters.compare = false;
        syncInputs();
        tabTo('catalog');
        commit();
      },
    },
    {
      key: 'high-debris',
      label: '高空碎片',
      title: '只看近地点 750 公里以上的碎片：大气几乎清不掉的那一层',
      apply: () => {
        filters.catalogVisible = false;
        filters.debrisVisible = true;
        filters.groups = new Set(groupRows.map((g) => g.id));
        filters.debrisBand = { lo: 750, hi: 1300 };
        filters.incl = null;
        filters.horizonYears = 0;
        filters.compare = false;
        syncInputs();
        tabTo('debris');
        commit();
      },
    },
    {
      key: 'decayed',
      label: '两百年后',
      title: '把时间推进到第 200 年，看哪些碎片还留在轨上',
      apply: () => {
        filters.catalogVisible = false;
        filters.debrisVisible = true;
        filters.groups = new Set(groupRows.map((g) => g.id));
        filters.debrisBand = null;
        filters.incl = null;
        filters.horizonYears = HORIZON_MAX;
        filters.compare = false;
        syncInputs();
        tabTo('debris');
        commit();
      },
    },
  ];
  const presetButtons = new Map<string, HTMLButtonElement>();
  for (const p of PRESETS) {
    const b = el('button', 'explore-preset mono', p.label);
    b.type = 'button';
    b.title = p.title;
    b.addEventListener('click', () => {
      p.apply();
    });
    presetButtons.set(p.key, b);
    presetHost.append(b);
  }
  presetSec.append(presetHost);

  // ---------- 页签 ----------
  const tabs = el('div', 'explore-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabCatalog = tabBtn('编目对象', 'catalog');
  const tabDebris = tabBtn('碎片', 'debris');
  tabs.append(tabCatalog, tabDebris);

  const panelCatalog = el('div', 'explore-tabpanel');
  panelCatalog.dataset.tab = 'catalog';
  const panelDebris = el('div', 'explore-tabpanel');
  panelDebris.dataset.tab = 'debris';

  // ---------- 编目：类别 ----------
  const catSec = section('对象类别');
  const catHost = el('div', 'explore-chips');
  const catButtons = new Map<number, HTMLButtonElement>();
  for (const row of categoryRows) {
    const b = chip(row.label, row.count.toLocaleString(), row.color);
    b.title = `${row.label}：${row.count.toLocaleString()} 个可定位对象`;
    b.addEventListener('click', () => {
      toggle(filters.categories, row.cat);
      paintCategories();
      commit();
    });
    catButtons.set(row.cat, b);
    catHost.append(b);
  }
  const catHint = el('p', 'explore-hint', '不选 = 这一类不画；全关 = 编目层为空。');
  catSec.append(catHost, catHint);

  // ---------- 编目：轨道类型 ----------
  const orbitSec = section('轨道类型');
  const orbitHost = el('div', 'explore-chips is-inline');
  const orbitButtons = new Map<number, HTMLButtonElement>();
  for (const row of orbitRows) {
    const b = chip(row.label, row.count.toLocaleString());
    b.title = `${row.label}：${row.count.toLocaleString()} 个可定位对象`;
    b.addEventListener('click', () => {
      toggle(filters.orbits, row.code);
      paintOrbits();
      commit();
    });
    orbitButtons.set(row.code, b);
    orbitHost.append(b);
  }
  const orbitHint = el('p', 'explore-hint', 'LEO 近地 / MEO 中轨 / GEO 地球同步 / HEO 大椭圆。');
  orbitSec.append(orbitHost, orbitHint);

  // ---------- 编目：近地点高度 ----------
  const bandSec = section('近地点高度');
  const bandSelect = selectEl();
  bandSelect.append(new Option('全部高度', ''));
  for (const b of bands) bandSelect.append(new Option(b.label, `${b.lo}:${b.hi}`));
  bandSelect.addEventListener('change', () => {
    filters.band = parseRange(bandSelect.value);
    commit();
  });
  bandSec.append(bandSelect);

  // ---------- 编目：发射年份区间 ----------
  const yearSec = section('发射年份');
  const yearHead = el('div', 'explore-slider-head');
  const yearLabel = el('span', 'explore-value mono', '全部年份');
  yearHead.append(yearLabel);
  const yearMinInput = rangeEl(opts.years.min, opts.years.max, opts.years.min);
  const yearMaxInput = rangeEl(opts.years.min, opts.years.max, opts.years.max);
  const yearScale = el('div', 'explore-scale mono');
  yearScale.append(el('span', '', String(opts.years.min)), el('span', '', String(opts.years.max)));
  const yearHint = el('p', 'explore-hint', '上下限都可拖：例如 2020–2026 只看最近七年。');
  const onYear = (): void => {
    const lo = Number(yearMinInput.value);
    const hi = Number(yearMaxInput.value);
    // 两个滑块互相约束，避免出现 min > max 的空区间
    if (lo > hi) {
      if (document.activeElement === yearMinInput) yearMaxInput.value = String(lo);
      else yearMinInput.value = String(hi);
    }
    const a = Number(yearMinInput.value);
    const b = Number(yearMaxInput.value);
    filters.yearMin = a <= opts.years.min ? null : a;
    filters.yearMax = b >= opts.years.max ? null : b;
    paintYear();
    commit();
  };
  yearMinInput.addEventListener('input', onYear);
  yearMaxInput.addEventListener('input', onYear);
  yearSec.append(yearHead, yearMinInput, yearMaxInput, yearScale, yearHint);

  panelCatalog.append(catSec, orbitSec, bandSec, yearSec);

  // ---------- 碎片：事件来源 ----------
  const groupSec = section('事件来源');
  const groupHost = el('div', 'explore-chips');
  const groupButtons = new Map<number, HTMLButtonElement>();
  for (const row of groupRows) {
    const b = chip(row.label, row.count.toLocaleString(), row.color);
    b.title = `${row.label}：${row.count.toLocaleString()} 个碎片`;
    b.addEventListener('click', () => {
      toggle(filters.groups, row.id);
      paintGroups();
      commit();
    });
    groupButtons.set(row.id, b);
    groupHost.append(b);
  }
  const groupHint = el('p', 'explore-hint', '三次事件各一个群，可任意组合。');
  groupSec.append(groupHost, groupHint);

  // ---------- 碎片：近地点 ----------
  const debrisBandSec = section('近地点高度');
  const debrisBandSelect = selectEl();
  debrisBandSelect.append(new Option('全部高度', ''));
  for (const b of debrisBands) {
    debrisBandSelect.append(new Option(b.label, `${b.lo}:${b.hi}`));
  }
  debrisBandSelect.addEventListener('change', () => {
    filters.debrisBand = parseRange(debrisBandSelect.value);
    commit();
  });
  debrisBandSec.append(debrisBandSelect);

  // ---------- 碎片：倾角 ----------
  const inclSec = section('轨道倾角');
  const inclSelect = selectEl();
  inclSelect.append(new Option('全部倾角', ''));
  for (const b of inclBands) inclSelect.append(new Option(b.label, `${b.lo}:${b.hi}`));
  inclSelect.addEventListener('change', () => {
    filters.incl = parseRange(inclSelect.value);
    commit();
  });
  const inclHint = el(
    'p',
    'explore-hint',
    '倾角是轨道面与赤道的夹角：风云群约 99°，撞击群约 74° 与 86°。'
  );
  inclSec.append(inclSelect, inclHint);

  // ---------- 碎片：时间推进 ----------
  const timeSec = section('时间推进');
  const timeHead = el('div', 'explore-slider-head');
  const timeLabel = el('span', 'explore-value mono', '现在');
  timeHead.append(timeLabel);
  const timeInput = rangeEl(0, HORIZON_MAX, 0);
  timeInput.addEventListener('input', () => {
    filters.horizonYears = Number(timeInput.value);
    paintTime();
    commit();
  });
  const timeScale = el('div', 'explore-scale mono');
  timeScale.append(el('span', '', '现在'), el('span', '', `${HORIZON_MAX} 年后`));
  const timeHint = el('p', 'explore-hint', '按实测衰减外推：低轨几年清空，800 公里以上几乎不动。');
  timeSec.append(timeHead, timeInput, timeScale, timeHint);

  panelDebris.append(groupSec, debrisBandSec, inclSec, timeSec);

  // ---------- 时间对照 ----------
  const compareSec = section('时间对照');
  const compareCheck = checkRow(
    '开启分屏对照',
    '左半为参照年及以前发射的对象，右半为现在；只作用于编目层'
  );
  const compareYearHead = el('div', 'explore-slider-head');
  const compareYearLabel = el('span', 'explore-value mono', `≤ ${filters.compareYear} 年`);
  compareYearHead.append(compareYearLabel);
  const compareYearInput = rangeEl(
    opts.compareYears.min,
    opts.compareYears.max,
    filters.compareYear
  );
  compareYearInput.addEventListener('input', () => {
    filters.compareYear = Number(compareYearInput.value);
    filters.compare = true;
    compareCheck.input.checked = true;
    paintCompare();
    commit();
  });
  const wipeHead = el('div', 'explore-slider-head');
  const wipeLabel = el('span', 'explore-value mono', '中缝 50%');
  wipeHead.append(wipeLabel);
  const wipeInput = rangeEl(8, 92, Math.round(filters.wipe * 100));
  wipeInput.addEventListener('input', () => {
    filters.wipe = Number(wipeInput.value) / 100;
    filters.compare = true;
    compareCheck.input.checked = true;
    paintCompare();
    commit();
  });
  const compareHint = el(
    'p',
    'explore-hint',
    '左右是同一机位、同一批对象，唯一差别是参照年。开启时碎片层暂时隐藏。'
  );
  compareSec.append(
    compareCheck.label,
    compareYearHead,
    compareYearInput,
    wipeHead,
    wipeInput,
    compareHint
  );

  compareCheck.input.addEventListener('change', () => {
    filters.compare = compareCheck.input.checked;
    syncCompareDisabled();
    paintCompare();
    commit();
  });

  // ---------- 底部 ----------
  const foot = el('div', 'explore-foot');
  const countLine = el('p', 'explore-count mono', '-');
  const clearBtn = smallBtn('重置全部筛选', '恢复默认：全部类别、轨道、高度、年份、群与倾角');
  foot.append(clearBtn, countLine);

  body.append(viewSec, presetSec, tabs, panelCatalog, panelDebris, compareSec);
  // 计数与「重置全部筛选」钉在面板底部：正文区自己滚动，筛选结果
  // 始终留在视野里，不必把面板拖到底才能看到「还剩多少」。
  root.append(head, body, foot);
  document.body.append(root);

  // ---------- 分屏标尺（覆盖在画布上，只在对照开启时显示） ----------
  const split = el('div', 'explore-split');
  split.hidden = true;
  const splitLine = el('div', 'explore-split-line');
  const splitLeft = el('div', 'explore-split-label is-left mono');
  const splitRight = el('div', 'explore-split-label is-right mono');
  split.append(splitLine, splitLeft, splitRight);
  document.body.append(split);

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

  function checkRow(
    label: string,
    title: string
  ): { label: HTMLLabelElement; input: HTMLInputElement } {
    const wrap = el('label', 'explore-check explore-check-row');
    wrap.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    wrap.append(input, document.createTextNode(label));
    return { label: wrap, input };
  }

  function chip(label: string, num: string | null, color?: string): HTMLButtonElement {
    const b = el('button', 'explore-chip mono');
    b.type = 'button';
    b.dataset.active = 'true';
    b.setAttribute('aria-pressed', 'true');
    if (color) {
      const dot = el('span', 'explore-dot');
      dot.style.background = color;
      b.append(dot);
    }
    b.append(el('span', 'explore-chip-label', label));
    if (num) b.append(el('span', 'explore-chip-num', num));
    return b;
  }

  function selectEl(): HTMLSelectElement {
    const s = document.createElement('select');
    s.className = 'explore-select mono';
    return s;
  }

  function rangeEl(min: number, max: number, value: number): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'range';
    i.className = 'explore-range';
    i.min = String(min);
    i.max = String(max);
    i.step = '1';
    i.value = String(value);
    return i;
  }

  function parseRange(v: string): { lo: number; hi: number } | null {
    if (!v) return null;
    const [lo, hi] = v.split(':').map(Number);
    return { lo, hi };
  }

  function toggle(set: Set<number>, key: number): void {
    if (set.has(key)) set.delete(key);
    else set.add(key);
  }

  function tabBtn(label: string, key: 'catalog' | 'debris'): HTMLButtonElement {
    const b = el('button', 'explore-tab mono', label);
    b.type = 'button';
    b.dataset.tab = key;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => tabTo(key));
    return b;
  }

  function tabTo(key: 'catalog' | 'debris'): void {
    tabCatalog.dataset.active = String(key === 'catalog');
    tabDebris.dataset.active = String(key === 'debris');
    tabCatalog.setAttribute('aria-selected', String(key === 'catalog'));
    tabDebris.setAttribute('aria-selected', String(key === 'debris'));
    panelCatalog.hidden = key !== 'catalog';
    panelDebris.hidden = key !== 'debris';
  }

  function paintCategories(): void {
    for (const [cat, b] of catButtons) {
      const on = filters.categories.has(cat);
      b.dataset.active = String(on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  function paintOrbits(): void {
    for (const [code, b] of orbitButtons) {
      const on = filters.orbits.has(code);
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
    const lo = filters.yearMin;
    const hi = filters.yearMax;
    if (lo === null && hi === null) yearLabel.textContent = '全部年份';
    else yearLabel.textContent = `${lo ?? opts.years.min} – ${hi ?? opts.years.max} 年`;
  }

  function paintTime(): void {
    timeLabel.textContent =
      filters.horizonYears === 0 ? '现在' : `第 ${filters.horizonYears} 年`;
  }

  function paintCompare(): void {
    compareYearLabel.textContent = `≤ ${filters.compareYear} 年`;
    wipeLabel.textContent = `中缝 ${Math.round(filters.wipe * 100)}%`;
    split.hidden = !(active && filters.compare);
    compareYearInput.disabled = !filters.compare;
    wipeInput.disabled = !filters.compare;
    if (!filters.compare) return;
    const pct = filters.wipe * 100;
    splitLine.style.left = `${pct}%`;
    const left = opts.compareLeftCount(filters.compareYear, filters);
    const now = opts.counts(filters).catalog;
    splitLeft.textContent = `≤ ${filters.compareYear} 年发射 · ${left.toLocaleString()} 个`;
    splitRight.textContent = `现在 · ${now.toLocaleString()} 个`;
    splitLeft.style.left = `calc(${pct}% - 10px)`;
    splitRight.style.left = `calc(${pct}% + 10px)`;
  }

  function syncCompareDisabled(): void {
    compareYearInput.disabled = !filters.compare;
    wipeInput.disabled = !filters.compare;
  }

  function paintCounts(): void {
    const c = opts.counts(filters);
    const total = c.catalog + c.debris;
    countLine.textContent =
      total === 0
        ? '画面里没有符合条件对象'
        : `画面中 ${c.catalog.toLocaleString()} 个编目对象 · ${c.debris.toLocaleString()} 个碎片` +
          (filters.compare ? '（分屏）' : '');
  }

  function paintPresets(): void {
    // 预设是否高亮只做弱提示：按下后各控件会显示真实状态，预设不是独立模式。
    for (const [key, b] of presetButtons) {
      b.dataset.active = String(
        key === 'all' &&
          filters.catalogVisible &&
          filters.debrisVisible &&
          filters.categories.size === categoryRows.length &&
          filters.orbits.size === orbitRows.length &&
          !filters.band &&
          filters.yearMin === null &&
          filters.yearMax === null &&
          filters.groups.size === groupRows.length &&
          !filters.debrisBand &&
          !filters.incl &&
          filters.horizonYears === 0 &&
          !filters.compare
      );
    }
  }

  function paintAll(): void {
    paintCategories();
    paintOrbits();
    paintGroups();
    paintYear();
    paintTime();
    paintCompare();
    paintPresets();
    paintCounts();
  }

  function commit(): void {
    opts.apply(filters);
    paintCounts();
    paintPresets();
    if (filters.compare) paintCompare();
  }

  /** 预设改动后把控件值同步到内存状态，避免界面与画面不一致。 */
  function syncInputs(): void {
    bandSelect.value = filters.band ? `${filters.band.lo}:${filters.band.hi}` : '';
    debrisBandSelect.value = filters.debrisBand
      ? `${filters.debrisBand.lo}:${filters.debrisBand.hi}`
      : '';
    inclSelect.value = filters.incl ? `${filters.incl.lo}:${filters.incl.hi}` : '';
    yearMinInput.value = String(filters.yearMin ?? opts.years.min);
    yearMaxInput.value = String(filters.yearMax ?? opts.years.max);
    timeInput.value = String(filters.horizonYears);
    compareCheck.input.checked = filters.compare;
    compareYearInput.value = String(filters.compareYear);
    wipeInput.value = String(Math.round(filters.wipe * 100));
    syncCompareDisabled();
    paintAll();
  }

  function resetFilters(): void {
    filters.catalogVisible = true;
    filters.debrisVisible = true;
    filters.categories = new Set(categoryRows.map((c) => c.cat));
    filters.orbits = new Set(orbitRows.map((o) => o.code));
    filters.band = null;
    filters.yearMin = null;
    filters.yearMax = null;
    filters.groups = new Set(groupRows.map((g) => g.id));
    filters.debrisBand = null;
    filters.incl = null;
    filters.horizonYears = 0;
    filters.compare = false;
    filters.compareYear = opts.compareYears.initial;
    filters.wipe = 0.5;
    syncInputs();
    commit();
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

  clearBtn.addEventListener('click', () => resetFilters());

  let active = false;

  /** 分屏层是否可见：面板关闭或关掉对照时一起收起。 */
  function syncSplitVisibility(): void {
    split.hidden = !(active && filters.compare);
  }

  return {
    get active() {
      return active;
    },
    open() {
      if (active) return;
      active = true;
      root.hidden = false;
      syncInputs();
      commit();
      syncSplitVisibility();
      opts.onResize?.();
      // 面板显隐由本模块负责；body 类、相机与叙事层退场由主循环处理，
      // 用事件把两件事接起来，避免本模块反向依赖主循环。
      window.dispatchEvent(new CustomEvent('orbit:explore-toggle', { detail: { on: true } }));
    },
    close() {
      if (!active) return;
      active = false;
      root.hidden = true;
      split.hidden = true;
      opts.onResize?.();
      window.dispatchEvent(new CustomEvent('orbit:explore-toggle', { detail: { on: false } }));
    },
    reapply() {
      syncInputs();
      commit();
      syncSplitVisibility();
      opts.onResize?.();
    },
    state() {
      const c = opts.counts(filters);
      return {
        ...filters,
        categories: new Set(filters.categories),
        orbits: new Set(filters.orbits),
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
    toggleCompare() {
      filters.compare = !filters.compare;
      compareCheck.input.checked = filters.compare;
      syncCompareDisabled();
      paintCompare();
      commit();
    },
  };
}
