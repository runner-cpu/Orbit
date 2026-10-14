/**
 * 第一章的文案与结构。
 *
 * 为什么文案单独成模块：
 *   参赛要求「内容由团队负责」。把文案集中在一处，团队修订时不必碰渲染代码，
 *   也便于逐条核对每个数字的出处。这里出现的每个数值都来自 Figures，
 *   不在文案里硬编码数字，避免数据更新后文案与现实脱节。
 *
 * 叙事原则（全片一致）：
 *   先给事实，再给解释，最后给结论。不使用煽情词汇，不做灾难化渲染，
 *   数字后面一定跟着「这个数字意味着什么」。
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

export const CHAPTER_ONE_STEPS: StepCopy[] = [
  {
    id: 'intro',
    nav: '开场',
    scene: 'establish',
    pinRatio: 0.9,
    render: () => `
      <p class="kicker">近地轨道 / 编目数据</p>
      <h1>轨道之上</h1>
      <p class="lead">
        在你读到这句话的时间里，头顶大约 400 公里的高度上，有超过一万六千个
        人造物体正以每秒 7.6 公里的速度掠过。
      </p>
      <p>
        这一页把它们全部画出来。每一个点对应一个真实存在的物体，
        位置由 CelesTrak 公开发布的轨道编目数据确定，没有一个是装饰。
      </p>
      <div class="hint">
        <span><kbd>拖动</kbd> 旋转视角</span>
        <span><kbd>双击</kbd> 复位</span>
        <span><kbd>Shift</kbd> + 滚轮缩放</span>
      </div>
    `,
  },
  {
    id: 'how-many',
    nav: '有多少',
    scene: 'wide',
    pinRatio: 1.1,
    render: (f) => `
      <div class="chapter-mark"><b>第一节</b><span>现在头顶上有多少东西</span></div>
      <h2>先看总数的两个口径</h2>
      <p>
        自 1957 年第一颗人造卫星入轨以来，人类一共向轨道编入过
        <strong>${int(f.cataloguedAllTime)}</strong> 个目标。
        其中已经再入大气层烧毁的占多数，目前仍在轨的是
        <strong>${int(f.cataloguedInOrbit)}</strong> 个。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">历史累计编目</span>
          <span class="readout-v">${int(f.cataloguedAllTime)}<small>个</small></span>
        </div>
        <div class="readout">
          <span class="readout-k">当前仍在轨</span>
          <span class="readout-v">${int(f.cataloguedInOrbit)}<small>个</small></span>
        </div>
        <div class="readout">
          <span class="readout-k">其中正在工作的载荷</span>
          <span class="readout-v">${int(f.workingPayloads)}<small>个</small></span>
          <div class="readout-note">
            占在轨总数的 ${fixed((f.workingPayloads / f.cataloguedInOrbit) * 100)}%。
            其余为碎片、火箭残骸、已失效或状态未记录的载荷。
          </div>
        </div>
      </div>
      <p class="cite">
        <b>口径</b> 两个数字来自不同的数据集。轨道编目总数取自 SATCAT（CelesTrak 卫星编目），
        含已再入目标；「正在工作」的判据是编目状态码为「正常运行」。
        本节其余所有读数均从 GP 轨道根数现场解算，见尾页「数据与方法」。
      </p>
    `,
  },
  {
    id: 'not-located',
    nav: '能看到什么',
    scene: 'locatable',
    pinRatio: 1.2,
    render: (f) => `
      <h2>你能看到的东西，不到在轨总数的六成</h2>
      <p>
        画面里这 ${int(f.located)} 个点，是目前能拿到公开轨道根数、
        因而可以被逐一定位的对象。另外 <strong>${int(f.notLocatable)}</strong> 个
        编目在轨目标没有公开根数，画不出来。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">可定位对象</span>
          <span class="readout-v">${int(f.located)}<small>个</small></span>
          <div class="readout-note">
            占在轨编目的 ${fixed((f.located / f.cataloguedInOrbit) * 100)}%
          </div>
        </div>
        <div class="readout">
          <span class="readout-k">编目在轨但无公开根数</span>
          <span class="readout-v is-warn">${int(f.notLocatable)}<small>个</small></span>
          <div class="readout-note">
            绝大多数是碎片与火箭残骸：它们没有在工作的发射方，也就没有人更新根数。
          </div>
        </div>
      </div>
      <div class="finding">
        <p>
          这意味着这一页画出的景象是<b>偏乐观</b>的：能画出来的以在工作的卫星为主，
          真正的碎片环境主体恰恰在画不出来的那一半里。
        </p>
      </div>
      <p class="cite">
        <b>方法</b> 可定位数取自本作解算的 GP 编目集合；无公开根数者由
        SATCAT 在轨总数与本集合求差得出。两者相减即为 ${int(f.cataloguedInOrbit)} −
        ${int(f.located)} = ${int(f.notLocatable)}。
      </p>
    `,
  },
  {
    id: 'crowding',
    nav: '挤在哪一层',
    scene: 'band',
    pinRatio: 1.3,
    render: (f) => {
      const rows = f.bands
        .filter((b) => b.count > 0)
        .map((b) => {
          const width = Math.max(1.5, (b.count / f.located) * 100);
          const hot = b.label === '400-600 km';
          return `
          <div class="band-row${hot ? ' is-hot' : ''}">
            <span class="band-label mono">${b.label}</span>
            <span class="band-track"><span class="band-fill" style="width:${width.toFixed(2)}%"></span></span>
            <span class="band-value mono">${int(b.count)}</span>
          </div>`;
        })
        .join('');

      return `
      <h2>不是均匀铺开，而是挤在同一层</h2>
      <p>
        把 ${int(f.located)} 个可定位对象按轨道高度分层，分布高度不均匀。
        近地轨道（2000 公里以下）占了 <strong>${fixed(f.leo.share)}%</strong>，
        其中绝大多数落在 <strong>400 至 600 公里</strong>这一段。
      </p>
      <div class="bands">${rows}</div>
      <p>
        这一段高度既够高，发射成本又相对可控，是载人航天、遥感与大型星座
        共同选择的工作层。代价是这一个高度层要同时容纳
        <strong>${fixed(f.recentShare)}%</strong> 于 2020 年以后发射的对象。
      </p>
      <div class="finding">
        <p>
          近地轨道不是一片空旷的场地，而是一个有实际容量上限的有限空间，
          并且正在被集中占用。
        </p>
      </div>
      <p class="cite">
        <b>口径</b> 高度为近地点高度，由 GP 轨道根数的平均运动与偏心率反算
        （a(1−e) − R⊕，R⊕ = 6378.137 km）。分层边界取 600 km 与 800 km：
        这两处对应大气阻力清除能力的转折，后续章节会用到。
      </p>
    `;
    },
  },
  {
    id: 'working-share',
    nav: '多少还在工作',
    scene: 'status',
    pinRatio: 1.2,
    render: (f) => {
      const rows = f.breakdown
        .filter((r) => r.count > 0)
        .map(
          (r) => `
        <div class="legend-row">
          <span class="legend-swatch ${swatchClass(r.key)}"></span>
          <span class="legend-label">${r.label}</span>
          <span class="legend-value">${int(r.count)}</span>
        </div>`
        )
        .join('');

      return `
      <h2>画面亮起来，是因为它们还在工作</h2>
      <p>
        按编目状态给每个对象分类着色后，一个反直觉的事实出现了：
        正在工作的载荷只占在轨总数的 <strong>${fixed((f.workingPayloads / f.cataloguedInOrbit) * 100)}%</strong>。
      </p>
      <div class="legend">${rows}</div>
      <div class="finding is-warn">
        <p>
          超过一半的在轨物体已经不工作了。它们不会因为没有任务而离轨，
          只会继续留在原来的轨道上。
        </p>
      </div>
      <p class="cite">
        <b>口径</b> 分类依据 SATCAT 的对象类型与运行状态码。
        「部分运行或待机」与「状态未记录」单独列出而不计入失效：
        这两种情况不能等同于已停止工作，混在一起会夸大结论。
      </p>
    `;
    },
  },
  {
    id: 'summary',
    nav: '小结',
    scene: 'recap',
    pinRatio: 1.0,
    render: (f) => `
      <h2>第一节到此为止</h2>
      <p>
        关于「现在有多少」，可以记住三个数字：在轨编目
        <strong>${int(f.cataloguedInOrbit)}</strong> 个，
        其中能定位到具体位置的 <strong>${int(f.located)}</strong> 个，
        而真正还在工作的载荷 <strong>${int(f.workingPayloads)}</strong> 个。
      </p>
      <p>
        这三者是同一片天空的三种口径。接下来的问题不是「还有多少」，
        而是这些不再工作的东西从哪里来，以及它们会在那里留多久。
      </p>
      <div class="readouts">
        <div class="readout">
          <span class="readout-k">下一节</span>
          <span class="readout-v">数量不是线性增长的</span>
        </div>
      </div>
    `,
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
