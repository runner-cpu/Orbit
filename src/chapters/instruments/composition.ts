/**
 * 第一章的仪器：对象构成尺。
 *
 * 第一章讲的全是「这一堆东西是什么」，但球上只有一片混在一起的光点，
 * 读者没有任何办法把其中一部分单独拿出来看。这台仪器补的就是这一步：
 * 每一类占两条横条，点一下只看球上属于这一类的那部分。
 *
 * 两种视图，按场景选：
 *
 *   口径阶梯（how-many）
 *     累计编目 → 仍在轨 → 可定位 / 无根数，四条嵌套的横条。
 *     这一步的正文给的是三个并列的数字，没有一处说明它们谁包含谁；
 *     横条的缩进把包含关系画出来。这一视图不可点。
 *
 *   两个口径并排（其余场景）
 *     同一类对象画两条横条：空心的是编目记下的，实心的是球上画得出来的。
 *     两条长度差得很远，这不是绘图错误，而是本页最核心的一个事实：
 *     编目里有 12,556 个碎片，但只有 2 个还留着公开轨道根数，因此只画得出 2 个。
 *     读者点「碎片」那一行，球会整体暗下去，只剩两个点亮着 —— 点选的结果
 *     本身就是这个差额的证明。
 *
 * 为什么把这两个口径并排放在同一行，而不是分两个视图：
 *   分开的时候，读者在编目视图里看到「碎片 12,556」，在球上什么也看不到；
 *   在可定位视图里看到「碎片 2」，又不知道为什么正文说有一万多。
 *   并排放之后，同一行里的两个数互为解释，不需要额外一段文字。
 */

import type { Instrument, InstrumentIntent, InstrumentPayload } from '../../core/instrument';
import { attachKeys, el } from '../../core/instrument';
import { int, fixed } from '../../core/format';

/** 类别号 → 柱子配色，与 pointCloud.ts 的 PALETTE.category 一一对应。 */
const CAT_COLOR = ['#7ad4f5', '#f0a94c', '#c98a9e', '#ff6b35', '#5a6b78'];

/**
 * 编目构成（七个键）→ 点云里的类别号。
 * 失效、部分运行、状态未记录三种都归到「已停止工作的载荷」这一类，
 * 因为点云的类别编码只有五档。三者在编目口径里的分项数字收进「依据」折叠块，
 * 不在这台仪器上摊开：仪器上摊开会与点云的类别对不上，反而制造矛盾。
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

/**
 * 合并后的五个类别，与点云的类别号一一对应。
 *
 * 顺序按「编目里有多少」而不是按类别号排，因为这张图要读的是
 * 哪一类在编目里占大头、其中又有多少画得出来。载荷排在最前是因为
 * 它的实心条几乎与空心条一样长，正好与下面几行形成对照。
 */
const MERGED_ROWS: { cat: number; label: string; keys: string[] }[] = [
  { cat: 0, label: '工作中的载荷', keys: ['working'] },
  { cat: 3, label: '碎片', keys: ['debris'] },
  { cat: 1, label: '已停摆的载荷', keys: ['failed', 'partial', 'unrecorded'] },
  { cat: 2, label: '火箭残骸', keys: ['rocket'] },
  { cat: 4, label: '未分类', keys: ['unknown'] },
];

type Mode = 'caliber' | 'paired';

const SCENE_MODE: Record<string, Mode> = {
  // 开场直接给并排视图：读者一进页面就有一个可以自己按的东西，
  // 而且按下去看到的是一个真实的差额，不是装饰性的动画。
  establish: 'paired',
  wide: 'caliber',
  locatable: 'paired',
  status: 'paired',
  'growth-fragmentation': 'paired',
};

/** 各场景的标题。读数由此说明「这一步在看什么」。 */
const TITLE: Record<string, (p: InstrumentPayload) => string> = {
  establish: (p) => `球上画得出的构成 · ${int(p.figures.located)} 个`,
  locatable: (p) =>
    `编目 ${int(p.figures.cataloguedInOrbit)} 个，球上 ${int(p.figures.located)} 个`,
  status: (p) => `编目在轨构成 · 共 ${int(p.figures.cataloguedInOrbit)} 个`,
  'growth-fragmentation': () => '碎片在编目里有多少，球上有多少',
  wide: () => '编目口径的包含关系',
};

interface Row {
  label: string;
  /** 决定实心横条长度的数：球上画得出来的那部分 */
  value: number;
  /** 空心横条的长度数：编目记下的那部分。没有则只画实心条。 */
  ghost?: number;
  color?: string;
  note?: string;
  /** 点选后要隔离的类别号；缺省表示这一行不可点 */
  category?: number;
  /** 横条相对本组基准值的长度 */
  scale: number;
  /** 空心横条相对本组基准值的长度 */
  ghostScale?: number;
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

  /** 由编目构成算出每一类的编目件数。 */
  function cataloguedByCat(p: InstrumentPayload): Map<number, number> {
    const out = new Map<number, number>();
    for (const r of p.figures.breakdown) {
      const cat = BREAKDOWN_TO_CAT[r.key];
      if (cat === undefined) continue;
      out.set(cat, (out.get(cat) ?? 0) + r.count);
    }
    return out;
  }

  /** 把当前场景的视图拼成统一的行数组。 */
  function rowsFor(mode: Mode, p: InstrumentPayload): Row[] {
    const f = p.figures;

    if (mode === 'caliber') {
      // 四行嵌套：每一行都是上一行的一部分。长度统一按累计编目归一，
      // 于是「仍在轨只有一半」「可定位又只有在轨的一半」直接看得出来。
      const total = Math.max(1, f.cataloguedAllTime);
      return [
        {
          label: '历史累计编目',
          value: f.cataloguedAllTime,
          scale: 1,
          depth: 0,
          note: '1957 年至今编入目录的全部目标，含已再入',
        },
        {
          label: '其中仍在轨',
          value: f.cataloguedInOrbit,
          scale: f.cataloguedInOrbit / total,
          depth: 1,
          note: `占累计编目 ${fixed((f.cataloguedInOrbit / total) * 100)}%`,
        },
        {
          label: '其中可定位',
          value: f.located,
          scale: f.located / total,
          depth: 2,
          note: `占仍在轨 ${fixed((f.located / f.cataloguedInOrbit) * 100)}%`,
        },
        {
          label: '编目在轨但无公开根数',
          value: f.notLocatable,
          scale: f.notLocatable / total,
          depth: 2,
          note: '编目里有记录，没有可算位置的根数',
        },
      ];
    }

    // paired：同一行画两条横条，空心的是编目，实心的是球上。
    const catalogued = cataloguedByCat(p);
    const located = new Map(f.locatedByCategory.map((r) => [r.key, r.count]));
    // 基准取编目口径里最长的那一条。两条横条共用同一把尺子，
    // 读者才能直接比长度；各用各的最大值会让 2 个碎片和 15,448 个载荷
    // 看起来一样长，那张图就没有信息了。
    const base = Math.max(1, ...MERGED_ROWS.map((m) => catalogued.get(m.cat) ?? 0));

    return MERGED_ROWS.map((m) => {
      const cat = catalogued.get(m.cat) ?? 0;
      const loc = located.get(m.cat) ?? 0;
      return {
        label: m.label,
        value: loc,
        ghost: cat,
        color: CAT_COLOR[m.cat],
        category: m.cat,
        scale: loc / base,
        ghostScale: cat / base,
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

    const titleFn = TITLE[p.scene];
    titleHost.textContent = titleFn ? titleFn(p) : '对象构成';

    rowsHost.replaceChildren();
    rowsHost.dataset.mode = mode;

    for (const r of rows) {
      const clickable = r.category !== undefined;
      const row = el(clickable ? 'button' : 'div', 'comp-row');
      if (clickable) {
        (row as HTMLButtonElement).type = 'button';
        row.dataset.cat = String(r.category);
        row.setAttribute(
          'aria-label',
          `${r.label}：编目 ${int(r.ghost ?? r.value)} 个，球上 ${int(r.value)} 个`
        );
      }
      row.dataset.depth = String(r.depth);
      // 点选后的读数要从这里取「球上有几个」，不能从 value 的文本里抠数字：
      // 并排视图的值是 `2 / 12,556` 这种形式，抠出来会变成 212556。
      row.dataset.located = String(r.value);

      // 色块位置恒定占一列。口径阶梯视图没有类别色，但仍然渲染一个
      // 透明色块：留空位而不是省略元素，否则后面的名称、横条、数量会
      // 各自左移一列，整行错位。
      const swatch = el('span', 'comp-swatch');
      if (r.color) swatch.style.background = r.color;
      else swatch.dataset.empty = 'true';
      row.append(swatch);

      row.append(el('span', 'comp-label', r.label));

      const track = el('span', 'comp-track');
      // 空心条在下、实心条在上。实心条就是「球上真正画出来的那一部分」，
      // 它落在空心条里的比例，一眼就是两个口径的差距。
      if (r.ghostScale !== undefined) {
        const ghost = el('span', 'comp-ghost');
        ghost.style.width = `${(r.ghostScale * 100).toFixed(2)}%`;
        track.append(ghost);
      }
      const fill = el('span', 'comp-fill');
      fill.style.width = `${Math.max(0.6, r.scale * 100).toFixed(2)}%`;
      if (r.color) fill.style.background = r.color;
      track.append(fill);
      row.append(track);

      const value = el('span', 'comp-value mono');
      // 两个数并排写在同一个格子里：「球上几个」在左，「编目里几个」在右、
      // 小一号、带斜杠。分成两格会让读者以为它们可以相加，
      // 写成 `2 / 12,556` 则只有一个读法：编目里一万两千多个，
      // 球上画得出两个。这正是这一步要读者看见的事。
      value.textContent = int(r.value);
      if (r.ghost !== undefined) {
        const of = el('small', undefined, ` / ${int(r.ghost)}`);
        value.append(of);
      }
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
      }

      // 悬停与点击共用一条读数通道：悬停说明这一行是什么，点击说明发生了什么。
      // 不可点的行也给悬停读数，否则口径阶梯那四行完全没有解释。
      row.addEventListener('pointerenter', () => {
        if (active !== null) return;
        readHost.textContent = r.ghost === undefined
          ? (r.note ?? `${r.label} ${int(r.value)} 个`)
          : `${r.label}：编目 ${int(r.ghost)} 个，其中 ${int(r.value)} 个能算出位置`;
      });

      rowsHost.append(row);
    }

    readHost.textContent = defaultRead();
  }

  function syncActive() {
    for (const node of rowsHost.children) {
      const b = node as HTMLElement;
      if (b.dataset.cat === undefined) continue;
      b.dataset.active = String(active !== null && Number(b.dataset.cat) === active);
    }
    // 撤销锁定时读数要回到默认那句。之前这里直接 return，
    // 于是按 Esc 之后面板上还留着上一类的说明，说的和画面不是一件事。
    if (active === null) {
      readHost.textContent = defaultRead();
      return;
    }
    const row = [...rowsHost.children].find(
      (n) => (n as HTMLElement).dataset.cat === String(active)
    ) as HTMLElement | undefined;
    const label = row?.querySelector('.comp-label')?.textContent ?? '该类';
    const n = Number(row?.dataset.located ?? '0');
    // 值那格是 `2 / 12,556`，斜杠后面才是编目数。取出来的时候把斜杠与空格
    // 一起去掉，否则读数里会多出一个前导空格。
    const ghost = (row?.querySelector('.comp-value small')?.textContent ?? '').replace(
      /^\s*\/\s*/,
      ''
    );
    // 点选之后球会整体暗下去，只留这一类亮着。如果这一类在球上只有个位数，
    // 读者看到的是一颗几乎全黑的球，必须在读数里说明这正是要展示的事实，
    // 否则会以为是渲染出错了。
    readHost.textContent =
      n > 0 && n <= 20
        ? `球上属于「${label}」的只有 ${n} 个${ghost ? `（编目 ${ghost} 个）` : ''}。编目里有记录，根数已经没人维护`
        : `已锁定「${label}」${ghost ? `，球上 ${n} 个 / 编目 ${ghost} 个` : ''}。再点一次取消`;
  }

  /** 未锁定任何一类时的默认读数。 */
  function defaultRead(): string {
    return rowsHost.dataset.mode === 'caliber'
      ? '四行是包含关系：下面每一行都属于上面那一行'
      : '空心是编目记下的，实心是球上画得出来的。点一类只看它';
  }

  return {
    id: 'category',
    label: '对象构成尺',
    mount(host, emit) {
      emitFn = emit;
      root = el('div', 'instrument instrument-composition');
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', '对象构成尺：点选一类可只看球上属于该类的那部分');

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
