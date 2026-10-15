/**
 * 第一章的仪器：对象构成尺。
 *
 * 第一章讲的全是「这一堆东西是什么」，但球上只有一片混在一起的光点，
 * 读者没有任何办法把其中一部分单独拿出来看。这台仪器补的就是这一步：
 * 每一类占一条横条，点一下只看这一类。
 *
 * 三种视图，按场景选：
 *   口径阶梯（how-many）  累计编目 → 仍在轨 → 可定位 / 无根数，四条嵌套的横条。
 *                         这一步的正文给的是三个并列的数字，没有一处说明
 *                         它们谁包含谁；横条的缩进把包含关系画出来。
 *   可定位集合（locatable）球上真实存在的那一批，按五类对象拆分。可点选。
 *   编目在轨构成（status） 编目口径的七类构成，每行同时给出「可定位多少」。
 *                         两个数字并排，正是这一步要读者看见的落差。
 *
 * 为什么同一台仪器要带两种口径：编目口径与可定位口径差一个数量级，
 * 而球上只能画可定位的那一批。把两者并排写出来，比在正文里解释一段更有效。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachKeys, el } from '../../core/instrument';
import { int } from '../../core/format';

/** 类别号 → 柱子配色，与 pointCloud.ts 的 PALETTE.category 一一对应。 */
const CAT_COLOR = ['#7ad4f5', '#f0a94c', '#c98a9e', '#ff6b35', '#5a6b78'];

/**
 * 编目构成的七个键 → 点云里的类别号。
 * 失效、部分运行、状态未记录三种都归到「已停止工作的载荷」这一类，
 * 因为点云的类别编码只有五档，这一点在读数里写明。
 */
const BREAKDOWN_TO_CAT: Record<string, number> = {
  working: 0,
  failed: 1,
  partial: 1,
  unrecorded: 1,
  rocket: 2,
  debris: 3,
  unknown: 4,
};

/** 每个场景用哪一种视图。表里没有的场景不挂这台仪器。 */
type Mode = 'caliber' | 'located' | 'catalogued';

const SCENE_MODE: Record<string, Mode> = {
  // 开场用可定位集合：四行数字都不长，但每一行都能点，
  // 读者一进页面就有一个可以自己按的东西，而不是只能看着球转。
  establish: 'located',
  wide: 'caliber',
  locatable: 'located',
  status: 'catalogued',
  'growth-fragmentation': 'catalogued',
};

interface Row {
  label: string;
  /** 决定横条长度的数 */
  value: number;
  /** 行首色块；口径阶梯用不上 */
  color?: string;
  /** 副读数（编目构成视图里放可定位数） */
  note?: string;
  /** 点选后要隔离的类别号；缺省表示这一行不可点 */
  category?: number;
  /** 横条相对本组最大值的长度 */
  scale: number;
  /** 缩进层级，用来画包含关系 */
  depth: number;
}

export function createCompositionInstrument(): Instrument {
  let root: HTMLElement;
  let titleHost: HTMLElement;
  let rowsHost: HTMLElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  let active: number | null = null;
  let paintedKey = '';

  /** 把当前场景的视图拼成统一的行数组。 */
  function rowsFor(mode: Mode, p: InstrumentPayload): Row[] {
    const f = p.figures;

    if (mode === 'caliber') {
      // 四行嵌套：每一行都是上一行的一部分。长度统一按累计编目归一，
      // 于是「仍在轨只有一半」「可定位又只有在轨的一半」直接看得出来。
      const total = Math.max(1, f.cataloguedAllTime);
      return [
        { label: '历史累计编目', value: f.cataloguedAllTime, scale: f.cataloguedAllTime / total, depth: 0 },
        { label: '其中仍在轨', value: f.cataloguedInOrbit, scale: f.cataloguedInOrbit / total, depth: 1 },
        { label: '其中可定位', value: f.located, scale: f.located / total, depth: 2 },
        { label: '编目在轨但无公开根数', value: f.notLocatable, scale: f.notLocatable / total, depth: 2 },
      ];
    }

    if (mode === 'located') {
      const rows = f.locatedByCategory.filter((r) => r.count > 0);
      const max = Math.max(1, ...rows.map((r) => r.count));
      return rows.map((r) => ({
        label: r.label,
        value: r.count,
        color: CAT_COLOR[r.key] ?? CAT_COLOR[4],
        category: r.key,
        scale: r.count / max,
        depth: 0,
      }));
    }

    // catalogued：编目口径的构成，每行并排给出可定位数
    const locatedOf = new Map(f.locatedByCategory.map((r) => [r.key, r.count]));
    const max = Math.max(1, ...f.breakdown.map((r) => r.count));
    return f.breakdown
      .filter((r) => r.count > 0)
      .map((r) => {
        const cat = BREAKDOWN_TO_CAT[r.key];
        const loc = cat === undefined ? 0 : (locatedOf.get(cat) ?? 0);
        return {
          label: r.label,
          value: r.count,
          color: cat === undefined ? CAT_COLOR[4] : CAT_COLOR[cat],
          note: `可定位 ${int(loc)}`,
          category: cat,
          scale: r.count / max,
          depth: 0,
        };
      });
  }

  function paint(p: InstrumentPayload) {
    const mode = SCENE_MODE[p.scene];
    if (!mode) return;
    const key = `${p.scene}`;
    if (key === paintedKey) return;
    paintedKey = key;
    active = null;

    const rows = rowsFor(mode, p);
    if (!rows.length) return;

    titleHost.textContent =
      mode === 'caliber'
        ? '编目口径的包含关系'
        : mode === 'located'
          ? `可定位集合构成 · 共 ${int(p.figures.located)} 个`
          : `编目在轨构成 · 共 ${int(p.figures.cataloguedInOrbit)} 个`;

    rowsHost.replaceChildren();
    rowsHost.dataset.mode = mode;

    for (const r of rows) {
      const clickable = r.category !== undefined;
      const row = el(clickable ? 'button' : 'div', 'comp-row');
      if (clickable) {
        (row as HTMLButtonElement).type = 'button';
        row.dataset.cat = String(r.category);
        row.setAttribute('aria-label', `${r.label}，${int(r.value)} 个${r.note ? `，${r.note}` : ''}`);
      }
      row.dataset.depth = String(r.depth);

      if (r.color) {
        const swatch = el('span', 'comp-swatch');
        swatch.style.background = r.color;
        row.append(swatch);
      }

      row.append(el('span', 'comp-label', r.label));

      const track = el('span', 'comp-track');
      const fill = el('span', 'comp-fill');
      fill.style.width = `${Math.max(1.2, r.scale * 100).toFixed(2)}%`;
      if (r.color) fill.style.background = r.color;
      track.append(fill);
      row.append(track);

      const value = el('span', 'comp-value mono');
      value.textContent = int(r.value);
      row.append(value);

      if (r.note) row.append(el('span', 'comp-note mono', r.note));

      if (clickable) {
        row.addEventListener('click', () => {
          if (active === r.category) {
            active = null;
            emitFn({ kind: 'reset' });
          } else {
            active = r.category ?? null;
            emitFn({ kind: 'category', category: r.category ?? null });
          }
          syncActive();
        });
        row.addEventListener('pointerenter', () => {
          const share = (r.value / Math.max(1, p.figures.cataloguedInOrbit)) * 100;
          readHost.textContent = r.note
            ? `${r.label} ${int(r.value)} 个（编目在轨的 ${share.toFixed(1)}%），${r.note}`
            : `${r.label} ${int(r.value)} 个，占可定位集合的 ${(
                (r.value / Math.max(1, p.figures.located)) *
                100
              ).toFixed(1)}%`;
        });
      }

      rowsHost.append(row);
    }

    readHost.textContent =
      mode === 'caliber'
        ? '四行是包含关系：下面每一行都属于上面那一行'
        : mode === 'located'
          ? '点选一类，只看这一类'
          : '点选一类，只看球上属于该类的那一部分';
  }

  function syncActive() {
    for (const node of rowsHost.children) {
      const b = node as HTMLElement;
      if (b.dataset.cat === undefined) continue;
      b.dataset.active = String(active !== null && Number(b.dataset.cat) === active);
    }
    if (active === null) return;
    // 编目构成视图里「已失效 / 部分运行 / 状态未记录」三行在点云里是同一类，
    // 点其中任意一行都会三行同时高亮。这里说清楚，否则读者会以为点错了。
    const dup = [...rowsHost.children].filter(
      (n) => (n as HTMLElement).dataset.cat === String(active)
    ).length;
    readHost.textContent =
      dup > 1
        ? `已锁定这一类（点云里这 ${dup} 行合并为一类），再点一次取消`
        : '已锁定该类，再点一次取消';
  }

  return {
    id: 'category',
    label: '对象构成尺',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-composition');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '对象构成尺：点选一类可只看该类');

      titleHost = el('p', 'instrument-title');
      rowsHost = el('div', 'comp-rows');
      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      root.append(titleHost, rowsHost, readHost);
      host.append(root);

      const cats = () =>
        [...rowsHost.children]
          .filter((n) => (n as HTMLElement).dataset.cat !== undefined)
          .map((n) => Number((n as HTMLElement).dataset.cat));
      const pick = (cat: number | null) => {
        active = cat;
        if (cat === null) emit({ kind: 'reset' });
        else emit({ kind: 'category', category: cat });
        syncActive();
      };

      root.tabIndex = 0;
      attachKeys(root, {
        step: (dir, big) => {
          const list = cats();
          if (!list.length) return;
          const cur = active === null ? -1 : list.indexOf(active);
          pick(list[Math.max(0, Math.min(list.length - 1, cur + dir * (big ? 2 : 1)))]);
        },
        home: () => pick(cats()[0] ?? null),
        end: () => pick(cats()[cats().length - 1] ?? null),
        reset: () => pick(null),
      });
    },
    update(p) {
      paint(p);
      syncActive();
    },
    setVisible(v) {
      root.hidden = !v;
    },
    resetUserState() {
      active = null;
      syncActive();
    },
    get engaged() {
      return false;
    },
  };
}
