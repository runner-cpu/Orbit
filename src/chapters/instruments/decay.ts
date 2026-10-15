/**
 * 第五章的仪器：时间滑块 + 分层存活条。
 *
 * 回答的问题是「这些东西会在那里留多久」。滑块从 0 拖到 200 年，
 * 拖到哪一年，球上就只剩那一年还没掉的碎片。右侧的分层存活条同步显示
 * 每一层还剩多少，于是「低层被清空、高层纹丝不动」是拖出来的，不是写出来的。
 *
 * 为什么滑块必须和球联动：
 *   这一章的核心不是「200 年后还剩 1457 个」这个数字，而是
 *   「低处会掉光，高处不会」这个形状。只有让读者自己拖，才会看到
 *   低层的点在头几十年里一片片消失，而 800 公里以上从头到尾没动过。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachDrag, attachKeys, clamp01, el, pointerFraction } from '../../core/instrument';
import { int } from '../../core/format';

const MAX_YEARS = 200;

export function createDecayInstrument(): Instrument {
  let root: HTMLElement;
  let track: HTMLElement;
  let handle: HTMLElement;
  let bandsHost: HTMLElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  let dragging = false;
  let userYears: number | null = null;
  let painted = false;

  /** 分层存活条：每条按「已清除比例」从下往上填充。 */
  function paint(p: InstrumentPayload) {
    if (painted) return;
    painted = true;
    bandsHost.replaceChildren();

    for (const b of p.figures.bandFigures) {
      const row = el('div', 'decay-band');
      row.dataset.label = b.label;

      row.append(el('span', 'decay-band-label mono', b.label));

      const bar = el('span', 'decay-band-bar');
      const fill = el('span', 'decay-band-fill');
      fill.style.width = `${b.removedShare ?? 0}%`;
      bar.append(fill);
      row.append(bar);

      const pct = el('span', 'decay-band-value mono');
      pct.textContent = b.estimated ? `${(b.removedShare ?? 0).toFixed(1)}%` : '不可估';
      row.append(pct);

      bandsHost.append(row);
    }
  }

  /**
   * 同步滑块位置与读数。
   *
   * 用户拖过就用用户的年份；否则跟随场景的 horizon（滚动驱动的外推）。
   * 两条通道互不覆盖：用户松手后如果继续滚动，场景会重新接管。
   */
  function sync(p: InstrumentPayload) {
    const years = userYears ?? p.horizon * MAX_YEARS;
    const t = clamp01(years / MAX_YEARS);
    handle.style.left = `${(t * 100).toFixed(2)}%`;
    track.dataset.userDriven = String(userYears !== null);

    // 读数取该年份的总剩余量：用相邻两个投影点线性插值，
    // 避免只有 50 / 100 / 200 三个点可用时读数跳动。
    const proj = p.figures.projections;
    let remain = p.figures.debrisAlive;
    if (proj.length) {
      const stops = [0, ...proj.map((x) => x.years)];
      const vals = [p.figures.debrisAlive, ...proj.map((x) => x.totalRemaining)];
      let k = 0;
      while (k < stops.length - 1 && years > stops[k + 1]) k += 1;
      if (k >= stops.length - 1) remain = vals[vals.length - 1];
      else {
        const f = (years - stops[k]) / Math.max(1, stops[k + 1] - stops[k]);
        remain = Math.round(vals[k] + (vals[k + 1] - vals[k]) * f);
      }
    }

    const highCount = p.figures.bandFigures
      .filter((b) => b.label.includes('750') || b.label.includes('800') || b.label.includes('900'))
      .reduce((s, b) => s + b.alive, 0);
    readHost.textContent =
      years < 1
        ? `现在 · 在轨 ${int(p.figures.debrisAlive)} 个，其中 ${int(highCount)} 个在 750 公里以上`
        : `${Math.round(years)} 年后 · 仍剩 ${int(remain)} 个`;
  }

  return {
    id: 'decay',
    label: '时间滑块',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-decay');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '时间滑块：拖动可把时间推进到 200 年内任一年');

      bandsHost = el('div', 'decay-bands');

      track = el('div', 'decay-track');
      track.tabIndex = 0;
      track.setAttribute('role', 'slider');
      track.setAttribute('aria-label', '时间推进年数');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', String(MAX_YEARS));

      const rail = el('span', 'decay-rail');
      handle = el('span', 'decay-handle');
      handle.append(el('span', 'decay-handle-grip'));
      track.append(rail, handle);

      // 刻度：0 / 50 / 100 / 200
      const ticks = el('div', 'decay-ticks');
      for (const y of [0, 50, 100, 200]) {
        const t = el('span', 'decay-tick');
        t.style.left = `${((y / MAX_YEARS) * 100).toFixed(2)}%`;
        t.append(el('span', 'decay-tick-label mono', y === 0 ? '现在' : `${y}`));
        ticks.append(t);
      }

      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      root.append(bandsHost, track, ticks, readHost);
      host.append(root);

      const apply = (e: PointerEvent) => {
        const f = pointerFraction(e, track, 'x');
        userYears = Math.round(f * MAX_YEARS);
        track.setAttribute('aria-valuenow', String(userYears));
        emitFn({ kind: 'horizon', years: userYears });
      };
      attachDrag(track, apply, (d) => {
        dragging = d;
      });

      attachKeys(track, {
        step: (dir, big) => {
          const cur = userYears ?? 0;
          userYears = Math.max(0, Math.min(MAX_YEARS, cur + dir * (big ? 25 : 5)));
          track.setAttribute('aria-valuenow', String(userYears));
          emitFn({ kind: 'horizon', years: userYears });
        },
        home: () => {
          userYears = 0;
          track.setAttribute('aria-valuenow', '0');
          emitFn({ kind: 'horizon', years: 0 });
        },
        end: () => {
          userYears = MAX_YEARS;
          track.setAttribute('aria-valuenow', String(MAX_YEARS));
          emitFn({ kind: 'horizon', years: MAX_YEARS });
        },
        reset: () => {
          userYears = null;
          emitFn({ kind: 'reset' });
        },
      });
    },
    update(p) {
      paint(p);
      sync(p);
    },
    setVisible(v) {
      root.hidden = !v;
    },
    resetUserState() {
      userYears = null;
      track.removeAttribute('aria-valuenow');
    },
    get engaged() {
      return dragging;
    },
  };
}
