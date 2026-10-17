/**
 * 第三到五章共用的仪器：碎片群选择器。
 *
 * 三章都在讲同一个问题的不同侧面：「这三个群各是什么、各剩多少」。
 * 前两章各有一台仪器（年份轴、高度剖面尺），第三到五章却只有第三章的直方图
 * 和第四章的转盘，第五章的读数全靠正文里的一张静态图例。这台仪器把那三处
 * 静态读数合成一个可点选的控件：点某个群，球上就只剩那个群。
 *
 * 读数随章节切换：
 *   第三、四章给「可定位 N 个」与近地点中位数，因为那两章讲的是分布形态；
 *   第五章给「仍在轨 N / 编目 M」，因为那一章讲的是清除。
 * 同一台仪器换一组读数，比新造一台仪器更省读者的学习成本。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachKeys, el } from '../../core/instrument';
import { int, fixed } from '../../core/format';

/** 群号 → 配色，与 scenes.ts 的 DEBRIS_PALETTE 一一对应。 */
const GROUP_COLOR = ['#ff7a45', '#4fc3f7', '#ffd54f'];

export function createFamilyInstrument(): Instrument {
  let root: HTMLElement;
  let titleHost: HTMLElement;
  let rowsHost: HTMLElement;
  let axisHost: HTMLElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  let active: number | null = null;
  let paintedKey = '';

  /**
   * 场景预设选中的是哪一个群。
   *
   * 场景表用区间表达筛选（{-0.5, 0.5} 是单群，{0.5, 2.5} 是两个群），
   * 这里把单群的情形还原成群号；跨两个群时返回 null，表示「没有单群被选中」。
   */
  function presetGroup(p: InstrumentPayload): number | null {
    const g = p.debrisGroups;
    if (!g) return null;
    if (g.hi - g.lo > 1.5) return null;
    const idx = Math.round(g.lo + 0.5);
    return idx >= 0 ? idx : null;
  }

  /** 第五章讲清除，读数换成「仍在轨 / 编目」。 */
  function isSurvival(p: InstrumentPayload): boolean {
    return p.scene.startsWith('decay-');
  }

  function paint(p: InstrumentPayload) {
    const survival = isSurvival(p);
    const key = survival ? 'survival' : 'locatable';
    if (key === paintedKey) return;
    paintedKey = key;
    active = null;

    const groups = p.figures.debris;
    if (!groups.length) return;

    titleHost.textContent = survival
      ? '三个碎片群 · 编目记录（含已再入）'
      : '三个碎片群 · 可定位（GP 根数集合）';

    // 横条统一按最大群归一，于是「风云一号C 比铱星33 大一个数量级」
    // 这件事在两章里都读得出来，不会因为换了一组数就改变长度关系。
    const max = Math.max(1, ...groups.map((g) => g.count));
    const scaleMax = survival
      ? Math.max(1, ...groups.map((g) => familyTotal(p, g.key) || g.count))
      : max;

    rowsHost.replaceChildren();
    axisHost.replaceChildren();

    for (let i = 0; i < groups.length; i += 1) {
      const g = groups[i];
      const total = familyTotal(p, g.key);
      const alive = familyAlive(p, g.key);
      const aliveShare = total > 0 ? alive / total : null;

      const row = el('button', 'fam-row');
      row.type = 'button';
      row.dataset.group = String(i);
      row.setAttribute(
        'aria-label',
        survival
          ? `${g.label}，编目 ${int(total)} 个，仍在轨 ${int(alive)} 个`
          : `${g.label}，可定位 ${int(g.count)} 个`
      );

      const swatch = el('span', 'fam-swatch');
      swatch.style.background = GROUP_COLOR[i] ?? GROUP_COLOR[0];
      row.append(swatch);

      row.append(el('span', 'fam-label', g.label));

      const track = el('span', 'fam-track');
      const fill = el('span', 'fam-fill');
      fill.style.background = GROUP_COLOR[i] ?? GROUP_COLOR[0];
      if (survival && aliveShare !== null) {
        // 第五章的条分两段：实心是仍在轨的那部分，右侧淡色是已清除的那部分。
        // 一眼能看出三个群的清除进度差别（34.6% / 64.4% / 82.5%）。
        fill.style.width = `${Math.max(1, (total / scaleMax) * 100).toFixed(2)}%`;
        const gone = el('span', 'fam-fill-gone');
        gone.style.width = `${(100 - aliveShare * 100).toFixed(2)}%`;
        fill.append(gone);
      } else {
        fill.style.width = `${Math.max(1, (g.count / scaleMax) * 100).toFixed(2)}%`;
      }
      track.append(fill);
      row.append(track);

      const valueHost = el('span', 'fam-value mono');
      valueHost.textContent = survival
        ? `${int(alive)} / ${int(total)}`
        : int(g.count);
      row.append(valueHost);

      row.addEventListener('click', () => {
        if (active === i) {
          active = null;
          emitFn({ kind: 'reset' });
        } else {
          active = i;
          emitFn({ kind: 'debris-group', group: i });
        }
        syncActive(p);
      });
      row.addEventListener('pointerenter', () => {
        readHost.textContent = survival
          ? `${g.label}：编目 ${int(total)} 个，已清除 ${fixed(
              (100 * (total - alive)) / Math.max(1, total)
            )}%，仍在轨 ${int(alive)} 个`
          : `${g.label}：可定位 ${int(g.count)} 个，近地点中位数 ${fixed(g.perigeeMedianKm)} 公里，` +
            `800 公里以上 ${int(g.above800km)} 个`;
      });

      rowsHost.append(row);
    }

    // 横轴：0 与最大值各一条刻度，让「条长」有参照
    const ticks = el('div', 'fam-axis');
    for (const [frac, label] of [
      [0, '0'],
      [1, int(scaleMax)],
    ] as [number, string][]) {
      const t = el('div', 'fam-tick');
      t.style.left = `${(frac * 100).toFixed(2)}%`;
      t.append(el('span', 'fam-tick-label mono', label));
      ticks.append(t);
    }
    axisHost.append(ticks);

    readHost.textContent = survival
      ? '点选一个群，只看它；再点一次取消'
      : '点选一个群，只看它；再点一次取消';
  }

  /** 场景预设的群也用同样的高亮，用户不必先点一下才知道当前看的是哪个。 */
  function syncActive(p?: InstrumentPayload) {
    const preset = p ? presetGroup(p) : null;
    // 正文里的图例也能锁定群；面板必须跟着亮，否则两个入口各说各的。
    const shown = active ?? p?.group ?? preset;
    for (const node of rowsHost.children) {
      const b = node as HTMLElement;
      b.dataset.active = String(shown !== null && Number(b.dataset.group) === shown);
    }
    if (active !== null || p?.group != null) readHost.textContent = '已锁定该群，再点一次取消';
    else if (preset !== null) readHost.textContent = '这一步只显示这一个群，点选可切换';
    else readHost.textContent = '点选一个群，只看它；再点一次取消';
  }

  return {
    id: 'family',
    label: '碎片群选择器',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-family');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '碎片群选择器：点选一个群可只看该群');

      titleHost = el('p', 'instrument-title');
      rowsHost = el('div', 'fam-rows');
      axisHost = el('div', 'fam-axis-host');
      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      root.append(titleHost, rowsHost, axisHost, readHost);
      host.append(root);

      const list = () => [...rowsHost.children].map((n) => Number((n as HTMLElement).dataset.group));
      const pick = (g: number | null) => {
        active = g;
        if (g === null) emit({ kind: 'reset' });
        else emit({ kind: 'debris-group', group: g });
        syncActive();
      };

      root.tabIndex = 0;
      attachKeys(root, {
        step: (dir, big) => {
          const gs = list();
          if (!gs.length) return;
          const cur = active === null ? -1 : gs.indexOf(active);
          pick(gs[Math.max(0, Math.min(gs.length - 1, cur + dir * (big ? 2 : 1)))]);
        },
        home: () => pick(list()[0] ?? null),
        end: () => pick(list()[list().length - 1] ?? null),
        reset: () => pick(null),
      });
    },
    update(p) {
      paint(p);
      syncActive(p);
    },
    setVisible(v) {
      root.hidden = !v;
    },
    resetUserState() {
      active = null;
    },
    get engaged() {
      return false;
    },
  };
}

/** 该群在编目记录里的总数（含已再入）。第五章的读数用它。 */
function familyTotal(p: InstrumentPayload, key: string): number {
  return p.figures.familySummary.find((x) => x.key === key)?.total ?? 0;
}

/** 该群仍在轨的数量（编目口径）。 */
function familyAlive(p: InstrumentPayload, key: string): number {
  return p.figures.familySummary.find((x) => x.key === key)?.alive ?? 0;
}
