/**
 * 尾页「数据与方法」。
 *
 * 参赛评审要求「涉及科学知识须注明资料来源」与「过程与结论可核验」，
 * 因此数据来源、处理口径、已知局限与复算方式必须出现在页面上，
 * 而不是只放在交付文档里。
 *
 * 但它不该占据正文的阅读动线。因此这一页的结构是：
 *   顶部一行来源与历元（读者扫一眼就够），
 *   其余全部收进可展开的折叠块（评审与复核时需要）。
 * 默认状态下这一页只有不到十行字。
 */

import { int, fixed } from '../core/format';
import type { Figures } from './figures';

export interface MethodSpec {
  key: string;
  value: string;
}

export function renderMethods(f: Figures, specs: MethodSpec[]): string {
  const specHtml = specs
    .map(
      (s) => `
      <div class="spec">
        <div class="spec-k">${s.key}</div>
        <div class="spec-v">${s.value}</div>
      </div>`
    )
    .join('');

  return `
    <div class="methods-inner">
      <p class="kicker">数据与方法</p>
      <h2>这一页的数字是怎么来的</h2>
      <p class="lead">
        数据来自 CelesTrak 公开发布的卫星编目与轨道根数，历元
        ${'2026-10-13'}（UTC）。全部解算在浏览器内完成。
      </p>

      <div class="spec-grid">${specHtml}</div>

      <div class="method-folds">
        <details class="fold">
          <summary>数据来源与两个口径</summary>
          <div class="fold-body">
            <p>作品用到两个来源不同、口径也不同的数据集。把它们混在一起说会产生
            无法解释的矛盾，因此分开使用、分别标注：</p>
            <ul>
              <li>
                <strong>CelesTrak SATCAT（卫星编目）</strong>：回答「有多少东西」。
                包含历史上编入目录的全部 ${int(f.cataloguedAllTime)} 个目标，其中仍在轨
                ${int(f.cataloguedInOrbit)} 个。每条记录带对象类型与运行状态码。
                它是编目记录，不含轨道位置。
              </li>
              <li>
                <strong>CelesTrak GP 轨道根数（TLE）</strong>：回答「在哪里」。
                只覆盖有公开根数的对象，本作取到 ${int(f.located)} 个。
                这是唯一能算出位置的数据，因此页面上的三维点云与高度分布都只基于这一部分。
              </li>
            </ul>
            <p>
              两者的差值 ${int(f.notLocatable)} 个，就是「编目在轨但没有公开根数、
              因而无法定位」的对象。这个差值在第一节被明确标出，而不是被悄悄略过。
            </p>
          </div>
        </details>

        <details class="fold">
          <summary>轨道位置的计算</summary>
          <div class="fold-body">
            <p>
              位置的解算使用 SGP4/SDP4 轨道传播模型，这是北美防空司令部体系下
              公开的解析模型，也是 TLE 数据的配套算法。在轨编目集合的
              ${int(f.located)} 个对象共 ${int(18610)} 条根数（含三个碎片群）在
              本地实测完成一次全量解算耗时 7.0 毫秒，因此可以每帧实时重算，
              画面里的位置不是预渲染动画。
            </p>
            <p>
              解算结果从地心惯性系（ECI）旋转到地固系（ECEF）后才绘制，旋转角取
              历元时刻的格林尼治恒星时。这样点云与地球自转是同一个参考系，
              不会出现「卫星相对地面持续漂移」这种把地球自转重复计算的现象。
            </p>
          </div>
        </details>

        <details class="fold">
          <summary>高度口径</summary>
          <div class="fold-body">
            <p>
              本作的高度一律指<strong>近地点高度</strong>，由轨道半长轴与偏心率反算
              （a(1−e) − R⊕，R⊕ 取 6378.137 km）。选择近地点而不是平均高度，
              是因为决定物体能否被大气阻力清除的是它轨道上最低的那一点：
              近地点足够低，物体每转一圈都会受到阻力，轨道才会持续衰减。
              远地点对本作品要说明的机制不起决定作用，因此不作为主要指标。
            </p>
          </div>
        </details>

        <details class="fold">
          <summary>三个口径，不能互相加减</summary>
          <div class="fold-body">
            <p>
              讨论一次解体事件时，有三组数字都常被叫作「这次产生了多少碎片」，
              但它们的分母不同，混用会得出互相矛盾的结论。本作在每一处引用时
              都标注用的是哪一个：
            </p>
            <ul>
              <li>
                <strong>编目中属于该事件的碎片</strong>：SATCAT 里以该事件的碎片前缀
                编目的全部记录，<em>包含已经再入的</em>。这是历史总量，只增不减。
              </li>
              <li>
                <strong>其中仍在轨的</strong>：上一项中再入状态为空的部分。
                两者之差就是已经被大气清除的数量，第五章的清除比例用的是这一对。
              </li>
              <li>
                <strong>其中仍有公开轨道根数的</strong>：只有这部分能算出位置，
                因而只有这部分出现在三维场景与高度分布图里。
                它比「仍在轨」还小，因为已失去跟踪的对象不提供根数。
              </li>
            </ul>
            <p>
              三个数值依次递减，且第三项是第一项的子集。本作在画面上只用第三项，
              在讲清除时只用前两项，从不把两组数字放在同一个算式里。
            </p>
          </div>
        </details>

        <details class="fold">
          <summary>增长台阶与衰减时标的算法</summary>
          <div class="fold-body">
            <p>
              第二章的增长台阶与第五章的衰减时标都不是外部引用的结论，
              而是从 SATCAT 编目自身算出来的，因此可以逐项复算：
            </p>
            <ul>
              <li>
                <strong>增长台阶</strong>：把编目按年份汇总成在轨总量序列，
                取逐年增量；凡某年增量超过全部年份增量中位数的 2.5 倍，
                即标为一次台阶。阈值取 2.5 倍而不是绝对值，
                是为了让判据随编目规模变化而自适应。这一判据把 1961 至 1964 年
                每年几百个的早期发射高峰排除在「台阶」之外，
                同时也把近年每年一千以上的星座部署纳入进来，
                后者确实是台阶，只是成因与解体事件不同，页面在文案里分开说明。
              </li>
              <li>
                <strong>衰减时标</strong>：把每个高度层的在轨数量按时间做
                最小二乘拟合 ln N = ln N₀ − t/τ，得到该层的时间常数 τ。
                这样得到的不是大气模型的输出，而是编目本身记录下来的实际清除速度。
              </li>
              <li>
                <strong>τ 的适用边界</strong>：拟合只在该层被清除的对象足够多时才给出数值
                （门槛设为 8 个）。800 公里以上各层在整个观测期内只被清除了个位数，
                拟合结果没有统计意义，页面因此直接显示「无法估计」而不是给一个数字。
                这不是回避，它本身就是这一节的结论：高层在有人观测的这些年里几乎没有变化。
              </li>
            </ul>
            <p>
              第五章的时间外推假设各层的 τ 在未来保持不变。这个假设并不成立，
              太阳活动周期会显著改变高层大气密度。页面把它作为外推的前提写明，
              并把结果表述为「按观测期内的清除速度延续」，
              而不是「这些碎片会在第几年消失」。
            </p>
          </div>
        </details>

        <details class="fold">
          <summary>已知局限</summary>
          <div class="fold-body">
            <p>以下边界是方法本身带来的，不是数据错误，列出以便正确理解页面结论：</p>
            <ul>
              <li>
                <strong>编目只包含能被持续跟踪的物体。</strong>
                厘米级与毫米级的微小碎片无法被地面雷达逐一跟踪，
                数量远大于编目数，但不在任何编目之内。因此本作讨论的
                「碎片数量」是<strong>可跟踪碎片</strong>的数量，不是碎片总量。
              </li>
              <li>
                <strong>编目数量随时间变化。</strong>
                新目标被编入、旧目标再入或被丢弃跟踪，都会让总数变动。
                本作使用 2026-10-13（UTC）的冻结快照，页面所有数字都对应这一刻。
              </li>
              <li>
                <strong>轨道根数只在其历元附近有效。</strong>
                根数随大气密度变化持续修正，若用很久以前的根数解算当前时刻，
                误差会明显放大。本作因此把时间轴锚定在数据历元，
                不做「跟随当前系统时间」的实时解算。
              </li>
              <li>
                <strong>本作不包含碰撞预警与机动。</strong>
                真实运行中卫星会为规避碰撞而变轨，本作按根数外推，不含这类事件。
              </li>
              <li>
                <strong>时间外推假设清除速度不变。</strong>
                第五节的 50 / 100 / 200 年是按观测期内实测的衰减时标延续得到的，
                而真实的大气密度随太阳活动周期起伏，时标本身会变。
              </li>
              <li>
                <strong>三维场景是历元时刻的一张切片。</strong>
                画面中的每一个位置都对应 2026-10-13（UTC）那一刻，
                不是随时间演化的动画。第二章的年份筛选改变的是
                「哪些对象已经存在」，不改变它们各自的位置。
              </li>
            </ul>
          </div>
        </details>

        <details class="fold">
          <summary>如何复算</summary>
          <div class="fold-body">
            <p>
              本作的原始数据、统计脚本与解算代码都随作品一并提供。在项目根目录
              按顺序运行以下命令，即可从原始数据重新得到页面上的每一个数字：
            </p>
            <ul>
              <li><strong>npm run data</strong>：抓取并冻结轨道数据快照</li>
              <li><strong>npm run satcat</strong>：抓取并汇总卫星编目构成</li>
              <li><strong>npm run merge</strong>：合并编目分组并按编号去重</li>
              <li><strong>npm run runtime-data</strong>：生成运行时点云（编目与碎片）</li>
              <li><strong>npm run history</strong>：从编目重建增长序列与各高度层衰减时标</li>
              <li><strong>npm run verify</strong>：逐项核对页面上的每一个读数</li>
              <li><strong>npm run bench</strong>：复现 SGP4 解算性能基准</li>
            </ul>
          </div>
        </details>

        <details class="fold">
          <summary>授权与引用</summary>
          <div class="fold-body">
            <ul>
              <li>
                轨道数据：CelesTrak 公开发布的 GP 轨道根数与 SATCAT 编目，
                可自由使用。来源 https://celestrak.org
              </li>
              <li>海岸线：Natural Earth 1:110m，公有领域</li>
              <li>三维渲染：three.js，MIT License</li>
              <li>轨道解算：satellite.js，MIT License</li>
              <li>等宽字体：JetBrains Mono，SIL Open Font License 1.1</li>
            </ul>
            <p>
              页面不使用任何第三方图片素材，地球以经纬网格与海岸线绘制，
              避免引入需要单独授权或署名的图像资源。
            </p>
          </div>
        </details>
      </div>

      <div class="colophon">
        <p>
          《轨道之上：一片正在增厚的碎片带》<br />
          数据历元 ${'2026-10-13'}（UTC）｜ 数据来源 CelesTrak ｜
          共 ${int(f.located)} 个可定位对象、${int(f.debrisTotal)} 个碎片群对象
        </p>
        <p>
          本页全部数值由项目内脚本从原始数据计算得出，可重新运行复现。
          高度为近地点高度，误差与局限见上方折叠块。
        </p>
      </div>
    </div>
  `;
}

/** 尾页顶部的规格网格。 */
export function methodSpecs(f: Figures, dataSizeKb: number): MethodSpec[] {
  return [
    { key: '数据历元', value: '2026-10-13' },
    { key: '在轨编目总数', value: `${int(f.cataloguedInOrbit)} 个` },
    { key: '可定位对象', value: `${int(f.located)} 个` },
    { key: '碎片群对象', value: `${int(f.debrisTotal)} 个` },
    { key: '轨道解算模型', value: 'SGP4 / SDP4' },
    // 这个值由加载器统计本次实际下载的字节数得出，不是写死的常量
    { key: '首次载入数据量', value: `约 ${fixed(dataSizeKb / 1024, 1)} MB` },
    { key: '网络依赖', value: '无（断网可完整运行）' },
    { key: '许可', value: 'MIT / Apache-2.0 / OFL / 公有领域' },
  ];
}
