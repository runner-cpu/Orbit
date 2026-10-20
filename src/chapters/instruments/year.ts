/**
 * 第二章的仪器：年份轴。
 *
 * 回答的问题是「现在这么多，是从哪一年开始变成这样的」。
 * 做法：横轴是真的年份刻度（1957 到数据末年），轴上画两条逐年累积曲线，
 * 曲线上的陡增段就是台阶。游标可以拖，拖到哪一年，球上就只剩那一年
 * 已经存在的对象。
 *
 * 为什么必须让游标真的改变球：
 *   只画一条曲线、游标跟着滚动走，读者看到的还是「一张图在动」。
 *   让游标驱动点云之后，「1980 年只有这么几个」与「2026 年有这么多」
 *   是同一个画面在两个时刻的样子，这句话才成立。
 *
 * 为什么画两条曲线：
 *   本章引用的数字来自 SATCAT 编目记录（含已再入与已失去跟踪的对象），
 *   而球上画的是其中仍有公开轨道根数、因而能被逐一定位的那一批。
 *   两者相差一个数量级，且差得越来越多。只画一条会让读者对不上：
 *   轴上写着 2,087，球上只有 5 个点。两条曲线并排之后，
 *   这个落差本身成为可读的信息，游标读数也同时给出两个数。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachDrag, attachKeys, el, pointerFraction, svgEl } from '../../core/instrument';
import { int } from '../../core/format';

const W = 560;
const H = 150;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 18;
const PAD_B = 30;

/**
 * 播放一遍 1957 → 数据末年所需的时间。
 *
 * 12 秒是试出来的：再快，读者来不及看清 1980 与 1999 两个台阶；
 * 再慢，答辩现场会等得不耐烦。两倍速给需要快速过一遍的场合。
 */
const PLAY_DURATION_MS = 12000;
/** 经过两次解体事件时停一下，让读数与脉冲标记被看见。 */
const EVENT_PAUSE_MS = 1100;

/**
 * 两个能被单独回放的事件。
 *
 * 为什么放在年份轴上而不是只写进第三、四章正文：
 *   这两次事件是「碎片带为什么变厚」的因果起点，但正文按章节拆开讲，
 *   读者在第二章看不到它们。把事件钉在时间轴上，第二章的「台阶」
 *   与后面两章的「事故」就连成了同一条时间线；点一下还能把球拨回那一年。
 *
 * 只标事件年份，不声称曲线在该年出现台阶：编目序列的跃升年份与
 * 解体年份并不逐年对齐（编目更新有滞后，且当年还有再入），
 * 把箭头画成「曲线在这里跳」会是错的。
 */
const EVENTS = [
  { year: 2007, label: '风云一号C 解体' },
  { year: 2009, label: '宇宙 2251 / 铱星 33 相撞' },
] as const;

export function createYearInstrument(): Instrument {
  let root: HTMLElement;
  let svg: SVGSVGElement;
  let curveAll: SVGPathElement;
  let curveLocated: SVGPathElement;
  let cursor: SVGGElement;
  let readHost: HTMLElement;
  let emitFn: (i: InstrumentIntent) => void;
  /** 事件标记：年份轴的 2007 / 2009 两个断点 */
  const eventMarks: { g: SVGGElement; year: number }[] = [];
  let dragging = false;
  let userYear: number | null = null;
  /** 当前画面上生效的年份。键盘微调以它为基准，否则一按就跳到另一端。 */
  let shownYear = 1957;

  // ---------- 播放器状态 ----------
  //
  // 播放不是「一条动画曲线」，而是真的按年份逐个发意图：球上的点云、
  // 顶部读数、图例里的筛选回显都走同一条通路。这样暂停在任何一帧，
  // 页面都停在一个自洽的状态上，而不是动画与画面各说各话。
  let playBtn: HTMLButtonElement;
  let speedBtn: HTMLButtonElement;
  let playNote: HTMLElement;
  let playing = false;
  let playFrame = 0;
  /** 播放头（浮点年份）。取整后才发意图，避免每秒发上百次。 */
  let playYear = 1957;
  let playLast = 0;
  let speed = 1;
  let lastPlayEmit = -1;
  /** 本次播放已经停靠过的事件年，避免在同一处反复停。 */
  const firedEvents = new Set<number>();
  let eventPauseUntil = 0;
  let reducedMotion: MediaQueryList | null = null;

  // 数据范围在第一次 update 时确定，之后不再变
  let y0 = 1957;
  let y1 = 2026;
  let maxCum = 1;
  /** SATCAT 编目在轨总量，逐年 */
  const cumAll = new Map<number, number>();
  /** 可定位集合的累积发射数，逐年 */
  const cumLocated = new Map<number, number>();

  function yearToX(year: number): number {
    const t = (year - y0) / Math.max(1, y1 - y0);
    return PAD_L + t * (W - PAD_L - PAD_R);
  }

  function xToYear(x: number): number {
    const t = (x - PAD_L) / Math.max(1, W - PAD_L - PAD_R);
    return Math.round(y0 + t * (y1 - y0));
  }

  function cumToY(v: number): number {
    const t = v / maxCum;
    return H - PAD_B - t * (H - PAD_T - PAD_B);
  }

  /** 逐年累积折线。台阶在曲线上表现为斜率突变，这正是本章要读者看见的东西。 */
  function pathFor(points: { x: number; y: number }[]): string {
    let d = '';
    points.forEach((p, i) => {
      d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    });
    return d;
  }

  function paint(p: InstrumentPayload) {
    const series = p.figures.historySeries;
    if (!series.length) return;

    y0 = p.figures.historyFirstYear;
    y1 = p.figures.historyLastYear;
    maxCum = Math.max(1, series[series.length - 1].inOrbit);

    cumAll.clear();
    for (const s of series) cumAll.set(s.year, s.inOrbit);

    // 可定位集合的逐年累积：由发射年直方图累加得出。
    // 它的量级远小于上面那条，但仍画在同一条纵轴上：
    // 两条曲线之间的距离就是两个口径的差距，换轴会把这件事抹掉。
    cumLocated.clear();
    let run = 0;
    for (const r of p.figures.launchCumulative) {
      run += r.count;
      cumLocated.set(r.year, run);
    }

    curveAll.setAttribute(
      'd',
      pathFor(series.map((s) => ({ x: yearToX(s.year), y: cumToY(s.inOrbit) })))
    );
    curveLocated.setAttribute(
      'd',
      pathFor(
        p.figures.launchCumulative.map((r) => ({ x: yearToX(r.year), y: cumToY(r.cumulative) }))
      )
    );

    // 事件标记的位置依赖 y0/y1，而这两个值要到第一次拿到数据后才知道，
    // 因此放在 paint 里定位，不放在 mount 里。
    for (const m of eventMarks) {
      m.g.setAttribute('transform', `translate(${yearToX(m.year).toFixed(1)} 0)`);
    }
  }

  /** 把游标画到某一年，并同步读数与事件标记的高亮。 */
  function paintCursor(year: number) {
    cursor.setAttribute('transform', `translate(${yearToX(year).toFixed(1)} 0)`);

    const all = cumAll.get(year) ?? cumAll.get(y1) ?? 0;
    const located = cumLocated.get(year) ?? 0;
    const event = EVENTS.find((e) => e.year === year);
    readHost.textContent = event
      ? `${year} 年 · ${event.label} · 编目在轨 ${int(all)} 个 · 画面内 ${int(located)} 个`
      : `${year} 年末 · 编目在轨 ${int(all)} 个 · 画面内 ${int(located)} 个`;
    // 游标正好停在事件年时，把标记点亮：读者能确认「我现在看的正是那一年」。
    for (const m of eventMarks) {
      m.g.setAttribute('data-active', String(m.year === year));
    }
    root.dataset.userDriven = String(userYear !== null);
  }

  /** 游标位置与读数。用户拖过就用用户的年份，否则跟随场景的年份上限。 */
  function syncCursor(p: InstrumentPayload) {
    const year = userYear ?? p.yearMax ?? y1;
    shownYear = year;
    paintCursor(year);
  }

  // ---------- 播放器 ----------
  //
  // 为什么播放器要逐帧改 userYear 再发意图，而不是直接动画 SVG 游标：
  //   年份轴的说服力来自「球真的回到了那一年」。只动游标是图表动画，
  //   动画结束后画面还是现在，读者什么也没得到。逐帧发 year 意图之后，
  //   播放到 1980 年暂停，球上就是 1980 年的那批点，读数也停在 1980。
  //
  // 为什么在事件年停一下：
  //   2007 与 2009 两个断点各只占整条时间轴的 3%，12 秒里不到 0.4 秒，
  //   一眨眼就过去了。停 1.1 秒并让标记脉冲，读者才来得及把「那一年发生了
  //   什么」与「曲线在这里抬起来」对上。

  /** 播放按钮上的文字随状态变；暂停时同时说明快捷键。 */
  function paintPlayUI() {
    if (!playBtn || !playNote) return;
    playBtn.textContent = playing ? '暂停' : '播放 1957→2026';
    playBtn.dataset.playing = String(playing);
    playBtn.setAttribute('aria-pressed', String(playing));
    speedBtn.textContent = `${speed}×`;
    speedBtn.setAttribute('aria-label', `播放速度 ${speed} 倍，点击切换`);
    playNote.textContent = playing
      ? `正在播放 · ${Math.round(playYear)} 年`
      : `12 秒走完整条时间轴 · 空格播放或暂停`;
  }

  function stopPlayback(opts: { restore?: boolean } = {}) {
    const was = playing;
    playing = false;
    if (playFrame) cancelAnimationFrame(playFrame);
    playFrame = 0;
    playLast = 0;
    eventPauseUntil = 0;
    firedEvents.clear();
    readHost.setAttribute('aria-live', 'polite');
    if (opts.restore) {
      userYear = null;
      emitFn({ kind: 'reset' });
    }
    if (was) paintPlayUI();
  }

  function startPlayback() {
    if (playing || y1 <= y0) return;
    playing = true;
    firedEvents.clear();
    eventPauseUntil = 0;
    playLast = 0;
    lastPlayEmit = -1;
    // 停在末年时从头放；否则从当前年份接着放。两种都符合直觉：
    // 「再放一遍」与「从这里继续」。
    const from = userYear ?? y1;
    playYear = from >= y1 - 0.5 ? y0 : Math.max(y0, from);
    userYear = Math.round(playYear);
    // 播放期间逐年播报会把读屏队列灌满；暂停后恢复。
    readHost.setAttribute('aria-live', 'off');
    paintPlayUI();
    emitFn({ kind: 'year', year: userYear });
    playFrame = requestAnimationFrame(stepPlayback);
  }

  function stepPlayback(ts: number) {
    if (!playing) return;
    if (!playLast) playLast = ts;
    // 标签页切回来时 delta 可能有好几秒，钳住它，避免一帧跳过几十年
    const dt = Math.min(120, ts - playLast);
    playLast = ts;

    if (ts < eventPauseUntil) {
      playFrame = requestAnimationFrame(stepPlayback);
      return;
    }

    const span = Math.max(1, y1 - y0);
    playYear += (dt / PLAY_DURATION_MS) * span * speed;

    const next = Math.min(y1, Math.floor(playYear));
    if (next !== lastPlayEmit) {
      lastPlayEmit = next;
      userYear = next;
      emitFn({ kind: 'year', year: next });
      // 播放中不走完整的 update（宿主只在步骤变化时推数据），
      // 这里直接把游标与读数推到当前年，否则球在动、轴上的游标不动。
      paintCursor(next);

      const ev = EVENTS.find((e) => e.year === next);
      // 降级模式下不插入停顿：脉冲动画本身已被系统关掉，
      // 停一秒只会让人以为页面卡住。
      if (ev && !firedEvents.has(ev.year) && !reducedMotion?.matches) {
        firedEvents.add(ev.year);
        eventPauseUntil = ts + EVENT_PAUSE_MS;
      }
      paintPlayUI();
    }

    if (playYear >= y1) {
      userYear = y1;
      emitFn({ kind: 'year', year: y1 });
      paintCursor(y1);
      stopPlayback();
      return;
    }
    playFrame = requestAnimationFrame(stepPlayback);
  }

  /** 播放器三种速度。0.5× 用于讲解时逐段停，2× 用于答辩快速过一遍。 */
  const SPEEDS = [1, 2, 0.5];

  return {
    id: 'year',
    label: '年份轴',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-year');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '年份轴：拖动游标可看某一年的在轨数量');

      svg = svgEl('svg', {
        viewBox: `0 0 ${W} ${H}`,
        preserveAspectRatio: 'none',
        class: 'year-svg',
      });

      // 基线
      svg.append(
        svgEl('line', {
          x1: PAD_L,
          y1: H - PAD_B,
          x2: W - PAD_R,
          y2: H - PAD_B,
          class: 'year-axis-line',
        })
      );

      // 可定位那条先画：它在下层，读者先看到的是完整编目那条。
      curveLocated = svgEl('path', { class: 'year-curve is-located' });
      curveAll = svgEl('path', { class: 'year-curve' });
      svg.append(curveLocated, curveAll);

      // 游标：一条竖线加顶端一个方块，方块是拖拽把手
      cursor = svgEl('g', { class: 'year-cursor' });
      cursor.append(
        svgEl('line', { x1: 0, y1: PAD_T - 6, x2: 0, y2: H - PAD_B, class: 'year-cursor-line' }),
        svgEl('rect', { x: -5, y: PAD_T - 12, width: 10, height: 10, class: 'year-cursor-grip' })
      );
      svg.append(cursor);

      // 年份刻度：每 20 年一条
      const ticks = svgEl('g', { class: 'year-ticks' });
      for (let yr = 1960; yr <= 2026; yr += 20) {
        const x = yearToX(yr);
        ticks.append(
          svgEl('line', { x1: x, y1: H - PAD_B, x2: x, y2: H - PAD_B + 4, class: 'year-tick' })
        );
        const t = svgEl('text', {
          x,
          y: H - PAD_B + 16,
          class: 'year-tick-label',
          'text-anchor': 'middle',
        });
        t.textContent = String(yr);
        ticks.append(t);
      }
      svg.append(ticks);

      // 事件标记：两条竖虚线 + 顶端小三角 + 年份。画在曲线之上、游标之下。
      // 每个标记本身是 focusable 的按钮：点一下把游标拨到事件当年，
      // 键盘 Tab 也能到达。
      for (const ev of EVENTS) {
        const idx = eventMarks.length;
        const g = svgEl('g', {
          class: 'year-event',
          tabindex: 0,
          role: 'button',
          'aria-label': `${ev.year} 年：${ev.label}，点击把年份拨到这一年`,
        });
        g.dataset.year = String(ev.year);

        // 悬停/读屏时给出完整事件名，光看「2007」不知道发生了什么。
        const title = svgEl('title');
        title.textContent = `${ev.year} 年 · ${ev.label}`;
        g.append(title);

        g.append(
          // 选中时向外扩散的脉冲圈：让「这一年有事件」不只是静态虚线，
          // 点下去能看见一个明确的反馈。默认透明，只在 data-active 时播放。
          svgEl('circle', {
            cx: 0,
            cy: PAD_T + 11,
            r: 4,
            class: 'year-event-halo',
          }),
          svgEl('line', {
            x1: 0,
            y1: PAD_T + 14,
            x2: 0,
            y2: H - PAD_B,
            class: 'year-event-line',
          }),
          svgEl('path', {
            d: `M-4 ${PAD_T + 8} L4 ${PAD_T + 8} L0 ${PAD_T + 14} Z`,
            class: 'year-event-head',
          })
        );
        // 2007 与 2009 在轴上只差约 16px，两个年份标签必须错开高度，
        // 否则会叠在一起。偶数在上、奇数在下。
        const label = svgEl('text', {
          x: 0,
          y: idx % 2 === 0 ? PAD_T - 2 : PAD_T + 22,
          class: 'year-event-label',
          'text-anchor': 'middle',
        });
        label.textContent = String(ev.year);
        g.append(label);
        svg.append(g);
        eventMarks.push({ g, year: ev.year });
      }

      // 游标要压在事件标记之上，否则拖动时竖线会被事件虚线切断。
      svg.append(cursor);

      // 图例：两条曲线各是什么。没有它，读者会以为下面那条是上面那条的一部分。
      const legend = el('div', 'year-legend');
      legend.append(
        el('span', 'year-legend-item is-all', '编目在轨（含已再入与无根数）'),
        el('span', 'year-legend-item is-located', '画面内（有公开根数）'),
        el('span', 'year-legend-item is-event', '虚线：两次解体事件，可点')
      );

      readHost = el('p', 'instrument-read mono');
      readHost.setAttribute('aria-live', 'polite');

      // 播放条：按钮 + 速度 + 一行状态。
      // 放在读数下面而不是压在图上：图本身还要能拖，播放条只占一行高度。
      const controls = el('div', 'year-play');
      playBtn = el('button', 'year-play-btn mono') as HTMLButtonElement;
      playBtn.type = 'button';
      playBtn.setAttribute('aria-label', '播放年份轴：从 1957 年逐年到 2026 年');
      speedBtn = el('button', 'year-play-speed mono') as HTMLButtonElement;
      speedBtn.type = 'button';
      playNote = el('span', 'year-play-note mono');
      controls.append(playBtn, speedBtn, playNote);

      playBtn.addEventListener('click', () => {
        if (playing) stopPlayback();
        else startPlayback();
      });
      speedBtn.addEventListener('click', () => {
        const i = SPEEDS.indexOf(speed);
        speed = SPEEDS[(i + 1) % SPEEDS.length];
        paintPlayUI();
      });

      root.append(svg, legend, readHost, controls);
      host.append(root);

      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      paintPlayUI();

      const apply = (e: PointerEvent) => {
        // 读者一碰到轴就接管：播放继续走会把刚拖到的年份立刻冲掉。
        if (playing) stopPlayback();
        // 换算用 svg 的矩形，事件挂在整块 root 上：这样从读数文字上起拖也能拖动，
        // 命中面积更大，触摸设备上更好按。
        const f = pointerFraction(e, svg, 'x');
        const year = xToYear(PAD_L + f * (W - PAD_L - PAD_R));
        userYear = Math.max(y0, Math.min(y1, year));
        emitFn({ kind: 'year', year: userYear });
      };

      attachDrag(root, apply, (d) => {
        dragging = d;
      });

      // 事件标记的点击：把年份拨到事件当年。
      // 阻止冒泡，避免同一次点击又被 attachDrag 当成拖动起点。
      for (const m of eventMarks) {
        const jump = (e: Event) => {
          e.stopPropagation();
          if (playing) stopPlayback();
          userYear = m.year;
          emitFn({ kind: 'year', year: m.year });
        };
        m.g.addEventListener('click', jump);
        m.g.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          jump(e);
        });
      }

      root.tabIndex = 0;
      attachKeys(root, {
        step: (dir, big) => {
          // 键盘接管时同样停止播放：否则下一次 rAF 会把年份改回去，
          // 读起来像按键没生效。
          if (playing) stopPlayback();
          // 以画面上当前的年份为基准，而不是以数据末端为基准：
          // 否则在 1965 那一步按一下右键会直接跳到 2026。
          const cur = userYear ?? shownYear;
          userYear = Math.max(y0, Math.min(y1, cur + dir * (big ? 10 : 1)));
          emitFn({ kind: 'year', year: userYear });
        },
        home: () => {
          if (playing) stopPlayback();
          userYear = y0;
          emitFn({ kind: 'year', year: y0 });
        },
        end: () => {
          if (playing) stopPlayback();
          userYear = y1;
          emitFn({ kind: 'year', year: y1 });
        },
        reset: () => {
          stopPlayback();
          userYear = null;
          emitFn({ kind: 'reset' });
        },
      });

      // 空格播放/暂停只在整个轴本身获得焦点时生效。
      // 不挂在 window 上：那会抢走页面滚动与按钮的空格激活。
      root.addEventListener('keydown', (e) => {
        if (e.key !== ' ' || e.target !== root) return;
        e.preventDefault();
        if (playing) stopPlayback();
        else startPlayback();
      });
    },
    update(p) {
      if (svg.dataset.painted !== '1') {
        paint(p);
        svg.dataset.painted = '1';
      }
      // 播放中不要用场景回读覆盖播放头：applyIntent 会同步改 yearMax，
      // 两者取整后可能差一年，回读会把游标往回拽。
      if (!playing) syncCursor(p);
      else shownYear = userYear ?? shownYear;
    },
    setVisible(v) {
      root.hidden = !v;
      // 切走这一步就停：仪器已经看不见，后台还在改年份，
      // 读者滚回来时会发现画面停在一个没操作过的年份。
      if (!v) stopPlayback();
    },
    resetUserState() {
      stopPlayback();
      userYear = null;
    },
    get engaged() {
      return dragging;
    },
  };
}
