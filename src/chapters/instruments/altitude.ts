/**
 * 第一章的仪器：高度剖面尺。
 *
 * 回答的问题是「这些东西挤在哪一层」。做法是把 200-2000 公里切成
 * 六段物理分界（不是等距），每段画一条长度与数量成正比的横条，
 * 纵轴是真的高度刻度，所以「400-600 这一段最长」是量出来的，不是排出来的。
 *
 * 交互：点某一段就只看那一段。这是本章唯一一个读者能自己做的动作，
 * 也是把「挤在同一层」从一句话变成一个可验证的事实的入口。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachDrag, attachKeys, el } from '../../core/instrument';
import { int } from '../../core/format';

/** 只显示这一段高度内的对象；横轴长度按这一段的计数定。 */
const VIEW_TOP_KM = 2000;
const VIEW_BOTTOM_KM = 200;

export function createAltitudeInstrument(): Instrument {
  let root: HTMLElement;
  let barsHost: HTMLElement;
  let axisHost: HTMLElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  let activeLo: number | null = null;
  let dragging = false;
  let lastCounts: number[] = [];

  /** 把 km 换算成容器内的百分比高度（0 = 底，1 = 顶）。 */
  function kmToFrac(km: number): number {
    const span = VIEW_TOP_KM - VIEW_BOTTOM_KM;
    return Math.max(0, Math.min(1, (km - VIEW_BOTTOM_KM) / span));
  }

  function paint(f: InstrumentPayload) {
    const bands = f.figures.bands.filter(
      (b) => b.lo < VIEW_TOP_KM && b.hi > VIEW_BOTTOM_KM
    );
    const counts = bands.map((b) => b.count);
    if (counts.join() === lastCounts.join() && barsHost.childElementCount === bands.length) {
      return;
    }
    lastCounts = counts;

    const max = Math.max(1, ...counts);
    barsHost.replaceChildren();
    axisHost.replaceChildren();

    for (const b of bands) {
      const lo = Math.max(b.lo, VIEW_BOTTOM_KM);
      const hi = Math.min(b.hi, VIEW_TOP_KM);
      const bottom = kmToFrac(lo) * 100;
      const height = (kmToFrac(hi) - kmToFrac(lo)) * 100;

      const row = el('button', 'alt-bar');
      row.type = 'button';
      row.style.bottom = `${bottom}%`;
      row.style.height = `${height}%`;
      row.dataset.lo = String(b.lo);
      row.dataset.hi = String(b.hi);
      row.setAttribute(
        'aria-label',
        `${b.label}，${int(b.count)} 个，占 ${b.share.toFixed(1)}%`
      );

      const fill = el('span', 'alt-bar-fill');
      fill.style.width = `${Math.max(2, (b.count / max) * 100)}%`;
      row.append(fill);

      const value = el('span', 'alt-bar-value mono', int(b.count));
      row.append(value);

      row.addEventListener('click', () => {
        if (activeLo === b.lo) {
          activeLo = null;
          emitFn({ kind: 'reset' });
        } else {
          activeLo = b.lo;
          emitFn({ kind: 'altitude-band', lo: b.lo, hi: b.hi });
        }
        syncActive();
      });

      barsHost.append(row);
    }

    // 高度刻度：每 400 公里一条，读数写在左侧
    for (let km = VIEW_BOTTOM_KM; km <= VIEW_TOP_KM; km += 400) {
      const tick = el('div', 'alt-tick');
      tick.style.bottom = `${kmToFrac(km) * 100}%`;
      const label = el('span', 'alt-tick-label mono', km === 0 ? '0' : String(km));
      tick.append(label);
      axisHost.append(tick);
    }
    // 顶端的 2000 不落在 400 的整数倍上，单独补一条
    const topTick = el('div', 'alt-tick');
    topTick.style.bottom = '100%';
    topTick.append(el('span', 'alt-tick-label mono', String(VIEW_TOP_KM)));
    axisHost.append(topTick);
  }

  /**
   * 高亮当前生效的那一层。
   *
   * 面板自己的点击记在 activeLo 里；正文里那一行数字锁定的层只有场景层知道，
   * 因此还要读 p.band。两个入口指向同一件事，画面上必须只有一个高亮，
   * 否则读者会以为它们控制的是不同的东西。
   */
  function syncActive(p?: InstrumentPayload) {
    const shown = activeLo ?? p?.band?.lo ?? null;
    for (const node of barsHost.children) {
      const b = node as HTMLElement;
      b.dataset.active = String(shown !== null && Number(b.dataset.lo) === shown);
    }
    readHost.textContent = shown === null ? '点选一层，只看这一层' : '已锁定该层，再点一次取消';
  }

  return {
    id: 'altitude',
    label: '高度剖面尺',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-altitude');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '高度剖面尺：点选一层可只看该层');

      axisHost = el('div', 'alt-axis');
      barsHost = el('div', 'alt-bars');
      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      root.append(axisHost, barsHost, readHost);
      host.append(root);

      // 键盘：上下键在相邻层之间移动，Escape 取消
      const loList = () => [...barsHost.children].map((n) => Number((n as HTMLElement).dataset.lo));
      const pick = (lo: number | null) => {
        activeLo = lo;
        if (lo === null) emit({ kind: 'reset' });
        else {
          const node = [...barsHost.children].find(
            (n) => Number((n as HTMLElement).dataset.lo) === lo
          ) as HTMLElement | undefined;
          if (node) {
            emit({
              kind: 'altitude-band',
              lo: Number(node.dataset.lo),
              hi: Number(node.dataset.hi),
            });
          }
        }
        syncActive();
      };
      attachKeys(root, {
        step: (dir, big) => {
          const list = loList();
          if (!list.length) return;
          const cur = activeLo === null ? -1 : list.indexOf(activeLo);
          const next = Math.max(0, Math.min(list.length - 1, cur + dir * (big ? 2 : 1)));
          pick(list[next]);
        },
        home: () => pick(loList()[0] ?? null),
        end: () => pick(loList()[loList().length - 1] ?? null),
        reset: () => pick(null),
      });

      // 让整块可聚焦，键盘用户 Tab 能到
      root.tabIndex = 0;
      root.addEventListener('focus', () => root.classList.add('is-focused'));
      root.addEventListener('blur', () => root.classList.remove('is-focused'));

      // 指针进入时标记 engaged，让滚动叙事暂停，避免用户点击时页面跳动
      attachDrag(root, () => {}, (d) => {
        dragging = d;
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
      activeLo = null;
      syncActive();
    },
    get engaged() {
      return dragging;
    },
  };
}
