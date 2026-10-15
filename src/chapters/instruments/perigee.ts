/**
 * 第三章的仪器：近地点直方图。
 *
 * 回答的问题是「碎片停在了哪个高度层」。50 公里一档，横轴是真的近地点
 * 刻度，纵轴是数量。主峰落在 800-850，而不是撞击发生的 865 附近，
 * 这是本章唯一的论点，柱状图自己就能把它读出来。
 *
 * 交互：悬停某一档看数量；点一下只留那一档的碎片；再点一次或按 Escape 取消。
 *
 * 直方图画的是风云一号C 这一个群，与球上当前显示的群是同一个：
 * 两个群的高度分布叠在一张图里会变成一团，读者读不出任何一个峰。
 * 图的标题写清是哪个群，因此不会与第四章的两个群混淆。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachKeys, el } from '../../core/instrument';
import { int } from '../../core/format';

/** 只画有碎片的区间；低于 250 公里与高于 1350 公里的档位不出现。 */
const DRAW_LO = 250;
const DRAW_HI = 1350;

/** 每个场景默认聚焦哪个群。与场景表的 debrisGroups 一致。 */
const SCENE_GROUP: Record<string, string> = {
  'fy-shell': 'fengyun1c',
  'impact-plane': 'cosmos2251',
};

export function createPerigeeInstrument(): Instrument {
  let root: HTMLElement;
  let titleHost: HTMLElement;
  let barsHost: HTMLElement;
  let axisHost: HTMLElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  let activeLo: number | null = null;
  /** 已画出的群，换群时重画一次 */
  let paintedKey: string | null = null;

  function paint(p: InstrumentPayload) {
    const key = SCENE_GROUP[p.scene] ?? 'fengyun1c';
    if (key === paintedKey) return;
    const g = p.figures.debris.find((d) => d.key === key);
    if (!g) return;

    const all = (g.perigeeBins ?? []).filter((b) => b.lo >= DRAW_LO && b.lo < DRAW_HI);
    if (!all.length) return;
    paintedKey = key;

    titleHost.textContent = `${g.label} · 近地点分布，每 50 公里一档`;

    // 每一档都占一个格子，含没有碎片的档。
    //
    // 为什么不能只画有数据的档：那样每根柱子等宽，而下面的刻度是按公里线性
    // 铺开的，两者对不上。读者会把「850 至 1250 之间没有碎片」误读成
    // 「这一段很窄」。留出空格之后，横轴才是一条真的近地点刻度。
    const step = all.length > 1 ? all[1].lo - all[0].lo : 50;
    const byLo = new Map(all.map((b) => [b.lo, b]));
    const slots: { lo: number; hi: number; count: number }[] = [];
    for (let lo = DRAW_LO; lo < DRAW_HI; lo += step) {
      const hit = byLo.get(lo);
      slots.push({ lo, hi: lo + step, count: hit ? hit.count : 0 });
    }

    const max = Math.max(1, ...slots.map((b) => b.count));
    // 最高的两档默认显示数量。这一章的全部论点就是「主峰在 750 至 850」，
    // 而这两根柱子在视觉上几乎等高，不标数字读者读不出 517 与 537 的差别。
    const peaks = new Set(
      [...slots]
        .sort((a, b) => b.count - a.count)
        .slice(0, 2)
        .map((b) => b.lo)
    );
    barsHost.replaceChildren();
    axisHost.replaceChildren();

    for (const b of slots) {
      if (b.count === 0) {
        // 空档也占位，但不接受点击：没有碎片可筛。
        const gap = el('span', 'pg-col pg-gap');
        gap.dataset.empty = 'true';
        barsHost.append(gap);
        continue;
      }

      const col = el('button', 'pg-col');
      col.type = 'button';
      col.dataset.lo = String(b.lo);
      col.dataset.hi = String(b.hi);
      col.setAttribute('aria-label', `近地点 ${b.lo} 至 ${b.hi} 公里，${int(b.count)} 个`);

      const fill = el('span', 'pg-fill');
      fill.style.height = `${Math.max(1.5, (b.count / max) * 100)}%`;
      col.append(fill);

      const cap = el('span', 'pg-cap mono', int(b.count));
      if (peaks.has(b.lo)) cap.dataset.peak = 'true';
      col.append(cap);

      col.addEventListener('click', () => {
        if (activeLo === b.lo) {
          activeLo = null;
          emitFn({ kind: 'reset' });
        } else {
          activeLo = b.lo;
          emitFn({ kind: 'perigee-bin', lo: b.lo, hi: b.hi });
        }
        syncActive();
      });
      col.addEventListener('pointerenter', () => {
        readHost.textContent = `${b.lo}-${b.hi} km · ${int(b.count)} 个`;
      });

      barsHost.append(col);
    }

    // 近地点刻度：每 100 公里一条，位置与上面的格子一一对应
    for (let km = DRAW_LO + step; km < DRAW_HI; km += step * 2) {
      const t = el('div', 'pg-tick');
      t.style.left = `${(((km - DRAW_LO) / (DRAW_HI - DRAW_LO)) * 100).toFixed(2)}%`;
      t.append(el('span', 'pg-tick-label mono', String(km)));
      axisHost.append(t);
    }
    readHost.textContent = '悬停看某一档的数量，点选只看这一档';
  }
  function syncActive() {
    for (const node of barsHost.children) {
      const b = node as HTMLElement;
      if (b.dataset.empty === 'true') continue;
      b.dataset.active = String(activeLo !== null && Number(b.dataset.lo) === activeLo);
    }
    readHost.textContent =
      activeLo === null
        ? '悬停看某一档的数量，点选只看这一档'
        : `已锁定 ${activeLo} 公里档，再点一次取消`;
  }

  return {
    id: 'perigee',
    label: '近地点直方图',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-perigee');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '近地点直方图：每 50 公里一档');

      titleHost = el('p', 'instrument-title');
      barsHost = el('div', 'pg-bars');
      axisHost = el('div', 'pg-axis');
      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      root.append(titleHost, barsHost, axisHost, readHost);
      host.append(root);

      // 键盘只在有碎片、因而可点选的档位之间移动，跳过空档。
      const loList = () =>
        [...barsHost.children]
          .filter((n) => (n as HTMLElement).dataset.empty !== 'true')
          .map((n) => Number((n as HTMLElement).dataset.lo));
      const pick = (lo: number | null) => {
        activeLo = lo;
        if (lo === null) emit({ kind: 'reset' });
        else {
          const node = [...barsHost.children].find(
            (n) => Number((n as HTMLElement).dataset.lo) === lo
          ) as HTMLElement | undefined;
          if (node) {
            emit({ kind: 'perigee-bin', lo: Number(node.dataset.lo), hi: Number(node.dataset.hi) });
          }
        }
        syncActive();
      };

      root.tabIndex = 0;
      attachKeys(root, {
        step: (dir, big) => {
          const list = loList();
          if (!list.length) return;
          const cur = activeLo === null ? -1 : list.indexOf(activeLo);
          pick(list[Math.max(0, Math.min(list.length - 1, cur + dir * (big ? 4 : 1)))]);
        },
        home: () => pick(loList()[0] ?? null),
        end: () => pick(loList()[loList().length - 1] ?? null),
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
      activeLo = null;
      syncActive();
    },
    get engaged() {
      return false;
    },
  };
}
