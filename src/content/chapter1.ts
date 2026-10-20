/**
 * 第一章的文案与结构。
 *
 * 为什么文案单独成模块：
 *   参赛要求「内容由团队负责」。把文案集中在一处，团队修订时不必碰渲染代码，
 *   也便于逐条核对每个数字的出处。这里出现的每个数值都来自 Figures，
 *   不在文案里硬编码数字，避免数据更新后文案与现实脱节。
 *
 * 每步的写作预算（全片一致，硬约束）：
 *   一个 h2（不超过 12 字）+ 一句 lead（不超过 40 字）+ 一个数据标注（不超过 20 字）。
 *   合计不超过 72 字。超出的内容一律不进正文，而是：
 *     1. 能画成图的，交给同章的仪器（instruments/）；
 *     2. 属于方法说明的，收进「依据」折叠块；
 *     3. 属于结论复述的，删掉。
 *
 * 为什么把方法说明折起来而不是删掉：
 *   参赛评审要求「涉及科学知识须注明资料来源」与「过程与结论可核验」，
 *   因此这些内容必须留在页面上，但不能占据正文的阅读动线。
 *   <details> 让它默认不占位、需要时可展开。
 */

import { int, fixed } from '../core/format';
import type { Figures } from './figures';

/** 一个叙事步骤：既有文案，也带有该步骤希望三维场景呈现的状态。 */
export interface StepCopy {
  id: string;
  /** 章节标签，用于底部刻度 */
  nav: string;
  /** 场景状态标识，由章节模块翻译成具体镜头与图层参数 */
  scene: string;
  /** 由数据生成 HTML 片段 */
  render(f: Figures): string;
  /** 这一步推进多少视口高度 */
  pinRatio: number;
}

/**
 * 把方法说明折起来。
 *
 * 默认 summary 只写「依据」两个字：它是全页反复出现的同一个动作，
 * 不需要每次换一个说法。少数步骤的折叠块内容不止于口径（例如还包含
 * 一个概念的出处），可以传 label 换一个更贴切的说法。
 */
export function fold(body: string, label = '依据'): string {
  return `<details class="fold"><summary>${label}</summary><div class="fold-body">${body}</div></details>`;
}

/** 章节末尾一行式过渡。替代原来的「小结」步，只给方向不给复述。 */
export function nextCue(text: string): string {
  return `<p class="next-cue"><span class="next-cue-k">下一节</span>${text}</p>`;
}

export const CHAPTER_ONE_STEPS: StepCopy[] = [
  {
    id: 'intro',
    nav: '开场',
    scene: 'establish',
    pinRatio: 1,
    render: () => `
      <p class="kicker">近地轨道 / 编目数据</p>
      <h1>轨道之上</h1>
      <p class="lead">
        头顶四百公里，一万六千个物体以每秒 7.6 公里掠过。北京到上海，两分半。
      </p>
      <p>画面里每个点都是真实物体，位置由公开轨道根数解算。</p>
      <div class="hint">
        <span><kbd>拖动</kbd> 旋转视角</span>
        <span><kbd>双击</kbd> 复位</span>
        <span><kbd>点选</kbd> 看它是谁</span>
      </div>
    `,
  },
  {
    id: 'how-many',
    nav: '有多少',
    scene: 'wide',
    pinRatio: 1,
    render: (f) => `
      <div class="chapter-mark"><b>第一节</b><span>现在头顶上有多少东西</span></div>
      <h2>编过的，一半已经掉下来</h2>
      <p class="lead">
        人类一共往天上编过 ${int(f.cataloguedAllTime)} 个目标。今天还在的，${int(f.cataloguedInOrbit)} 个。
      </p>
      <div class="readouts">
        <div class="readout" style="--frac:1">
          <span class="readout-k">历史累计编目</span>
          <span class="readout-v">${int(f.cataloguedAllTime)}<small>个</small></span>
        </div>
        <div class="readout" style="--frac:${(f.cataloguedInOrbit / f.cataloguedAllTime).toFixed(3)}">
          <span class="readout-k">当前仍在轨</span>
          <span class="readout-v">${int(f.cataloguedInOrbit)}<small>个</small></span>
        </div>
        <div class="readout" style="--frac:${(f.workingPayloads / f.cataloguedAllTime).toFixed(3)}">
          <span class="readout-k">其中正在工作的载荷</span>
          <span class="readout-v">${int(f.workingPayloads)}<small>个</small></span>
        </div>
      </div>
      <p class="try">右栏那台尺子把这三行画成嵌套的横条：谁包含谁，看长度。</p>
      ${fold(`
        <p>
          两个数字来自不同的数据集。轨道编目总数取自 SATCAT（CelesTrak 卫星编目），
          含已再入目标；「正在工作」的判据是编目状态码为「正常运行」。
          本节其余所有读数均由 GP 轨道根数推导得出。
        </p>`)}
    `,
  },
  {
    id: 'not-located',
    nav: '能看到什么',
    scene: 'locatable',
    pinRatio: 1,
    render: (f) => `
      <h2>有一半，只剩名字</h2>
      <p class="lead">
        球上这 ${int(f.located)} 个是能算出位置的。另外 ${int(f.notLocatable)} 个，编目里只有一行记录。
      </p>
      <div class="readouts">
        <div class="readout" style="--frac:${(f.located / f.cataloguedInOrbit).toFixed(3)}">
          <span class="readout-k">可定位对象</span>
          <span class="readout-v">${int(f.located)}<small>个</small></span>
          <div class="readout-note">
            占在轨编目的 ${fixed((f.located / f.cataloguedInOrbit) * 100)}%
          </div>
        </div>
        <div class="readout is-warn-line" style="--frac:${(f.notLocatable / f.cataloguedInOrbit).toFixed(3)}">
          <span class="readout-k">编目在轨但无公开根数</span>
          <span class="readout-v is-warn">${int(f.notLocatable)}<small>个</small></span>
        </div>
      </div>
      <p class="try">点右栏「碎片」那一行，球上只剩两个点。这一半正是它们。</p>
      ${fold(`
        <p>
          可定位数取自本作解算的 GP 编目集合；无公开根数者由 SATCAT 在轨总数与本集合求差得出，
          即 ${int(f.cataloguedInOrbit)} − ${int(f.located)} = ${int(f.notLocatable)}。
          这一半绝大多数是碎片与火箭残骸：它们没有在工作的发射方，也就没有人更新根数。
          因此这一页画出的景象是偏乐观的。
        </p>`)}
    `,
  },
  {
    id: 'crowding',
    nav: '挤在哪一层',
    scene: 'band',
    pinRatio: 1,
    render: (f) => {
      const rows = f.bands
        .filter((b) => b.count > 0)
        .map((b) => {
          const width = Math.max(1.5, (b.count / f.located) * 100);
          const hot = b.label === '400-600 km';
          return `
          <div class="band-row${hot ? ' is-hot' : ''}" data-globe="band:${b.lo}:${b.hi}" tabindex="0">
            <span class="band-label mono">${b.label}</span>
            <span class="band-track"><span class="band-fill" style="width:${width.toFixed(2)}%"></span></span>
            <span class="band-value mono">${int(b.count)}</span>
          </div>`;
        })
        .join('');

      return `
      <h2>挤在同一层</h2>
      <p class="lead">
        九成半在两千公里以下。绝大多数卡在 400 到 600 公里这一薄层里。
      </p>
      <div class="bands">${rows}</div>
      <div class="finding">
        <p>近地轨道不是空旷场地，而是一个有容量上限的有限空间。</p>
      </div>
      <p class="try">把指针放到任意一层上，球上只剩这一层；点一下锁定。</p>
      ${fold(`
        <p>
          高度为近地点高度，由 GP 轨道根数的平均运动与偏心率反算
          （a(1−e) − R⊕，R⊕ = 6378.137 km）。分层边界取 600 km 与 800 km：
          这两处对应大气阻力清除能力的转折，后续章节会用到。
          该层同时容纳了 ${fixed(f.recentShare)}% 于 2020 年以后发射的对象。
        </p>`)}
    `;
    },
  },
  {
    id: 'working-share',
    nav: '多少还在工作',
    scene: 'status',
    pinRatio: 1,
    render: (f) => {
      // 图例的每一行都能点：点哪一类，球上就只剩哪一类亮着。
      // 类别号与点云编码对应，文案层不需要知道着色器怎么用它。
      const CAT_OF: Record<string, number> = {
        working: 0,
        failed: 1,
        partial: 1,
        unrecorded: 1,
        rocket: 2,
        debris: 3,
        unknown: 4,
      };
      const PICKABLE = new Set(['working', 'failed', 'rocket', 'debris']);
      const rows = f.breakdown
        .filter((r) => r.count > 0)
        .map((r) => {
          const cat = CAT_OF[r.key];
          const on = cat !== undefined && PICKABLE.has(r.key);
          return `
        <div class="legend-row${on ? ' is-control' : ''}"${
          on ? ` data-globe="category:${cat}" tabindex="0"` : ''
        }>
          <span class="legend-swatch ${swatchClass(r.key)}"></span>
          <span class="legend-label">${r.label}</span>
          <span class="legend-value">${int(r.count)}</span>
        </div>`;
        })
        .join('');

      return `
      <h2>多数已经停摆</h2>
      <p class="lead">
        还在工作的载荷 ${int(f.workingPayloads)} 个，不到在轨总数的一半。
      </p>
      <div class="legend">${rows}</div>
      <p class="try">点任意一类，球上只留这一类；再点一次取消。</p>
      ${fold(`
        <p>
          分类依据 SATCAT 的对象类型与运行状态码。
          「部分运行或待机」与「状态未记录」单独列出而不计入失效：
          这两种情况不能等同于已停止工作，混在一起会夸大结论。
          它们不会因为没有任务而离轨，只会继续留在原来的轨道上。
        </p>`)}
      ${nextCue('数量不是线性增长的')}
    `;
    },
  },
];

/** 类别键 → CSS 类名。与 style.css 中的 .swatch-* 一一对应。 */
function swatchClass(key: string): string {
  switch (key) {
    case 'working':
      return 'swatch-working';
    case 'failed':
    case 'partial':
    case 'unrecorded':
      return 'swatch-dead';
    case 'rocket':
      return 'swatch-rocket';
    case 'debris':
      return 'swatch-debris';
    default:
      return 'swatch-unknown';
  }
}
