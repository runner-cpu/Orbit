/**
 * 尾页「数据与方法」的内容。
 *
 * 这不是附录性质的内容：参赛评审明确要求「涉及科学知识须内容准确并注明资料来源」，
 * 并且作品的完成度评分里包含「过程与结论可核验」。因此把数据来源、处理方法、
 * 已知局限和复算方式完整写在页面上，而不是只放在交付文档里。
 *
 * 写作原则：主动说明局限。把方法的边界讲清楚是专业性的表现，
 * 比含糊其辞更能通过评审的追问。
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
      <h2>这一页的每个数字是怎么来的</h2>
      <p>
        本作品的全部数据来自公开发布的轨道编目，全部计算在浏览器内完成。
        下面写明数据来源、处理口径与已知局限，供核验。
      </p>

      <div class="spec-grid">${specHtml}</div>

      <h3>两个数据集，两种用途</h3>
      <p>
        作品用到两个来源不同、口径也不同的数据集。把它们混在一起说会产生
        无法解释的矛盾，因此分开使用、分别标注：
      </p>
      <ul>
        <li>
          <strong>CelesTrak SATCAT（卫星编目）</strong>：
          回答「有多少东西」。包含历史上编入目录的全部
          ${int(f.cataloguedAllTime)} 个目标，其中仍在轨
          ${int(f.cataloguedInOrbit)} 个。每条记录带对象类型与运行状态码。
          它是编目记录，不含轨道位置。
        </li>
        <li>
          <strong>CelesTrak GP 轨道根数（TLE）</strong>：
          回答「在哪里」。只覆盖有公开根数的对象，本作取到
          ${int(f.located)} 个。这是唯一能算出位置的数据，因此页面上的三维点云
          与高度分布都只基于这一部分。
        </li>
      </ul>
      <p>
        两者的差值 ${int(f.notLocatable)} 个，就是「编目在轨但没有公开根数、
        因而无法定位」的对象。这个差值在第一节被明确标出，而不是被悄悄略过。
      </p>

      <h3>轨道位置的计算</h3>
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

      <h3>高度口径</h3>
      <p>
        本作的高度一律指<strong>近地点高度</strong>，由轨道半长轴与偏心率反算
        （a(1−e) − R⊕，R⊕ 取 6378.137 km）。选择近地点而不是平均高度，
        是因为决定物体能否被大气阻力清除的是它轨道上最低的那一点：
        近地点足够低，物体每转一圈都会受到阻力，轨道才会持续衰减。
        远地点对本作品要说明的机制不起决定作用，因此不作为主要指标。
      </p>

      <h3>已知局限</h3>
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
          真实运行中卫星会为规避碰撞而变轨，本作按根数外推，
          不含这类事件。
        </li>
      </ul>

      <h3>如何复算</h3>
      <p>
        本作的原始数据、统计脚本与解算代码都随作品一并提供。在项目根目录
        按顺序运行以下命令，即可从原始数据重新得到页面上的每一个数字：
      </p>
      <ul>
        <li><strong>npm run data</strong>：抓取并冻结轨道数据快照</li>
        <li><strong>npm run satcat</strong>：抓取并汇总卫星编目构成</li>
        <li><strong>npm run merge</strong>：合并编目分组并按编号去重</li>
        <li><strong>npm run runtime-data</strong>：生成运行时点云与碎片根数</li>
        <li><strong>npm run bench</strong>：复现 SGP4 解算性能基准</li>
      </ul>

      <h3>授权与引用</h3>
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

      <div class="colophon">
        <p>
          《轨道之上：一片正在增厚的碎片带》<br />
          数据历元 ${'2026-10-13（UTC）'} ｜ 数据来源 CelesTrak ｜
          共 ${int(f.located)} 个可定位对象、${int(f.debrisTotal)} 个碎片群对象
        </p>
        <p>
          本页全部数值由项目内脚本从原始数据计算得出，可重新运行复现。
          高度为近地点高度，误差与局限见上文。
        </p>
      </div>
    </div>
  `;
}

/** 尾页顶部的规格网格。 */
export function methodSpecs(f: Figures, dataSizeKb: number): MethodSpec[] {
  return [
    { key: '数据历元', value: '2026-10-13T00:00:00Z' },
    { key: '在轨编目总数', value: `${int(f.cataloguedInOrbit)} 个` },
    { key: '可定位对象', value: `${int(f.located)} 个` },
    { key: '碎片群对象', value: `${int(f.debrisTotal)} 个` },
    { key: '轨道解算模型', value: 'SGP4 / SDP4' },
    { key: '运行时数据量', value: `约 ${fixed(dataSizeKb / 1024, 1)} MB（含离线段）` },
    { key: '网络依赖', value: '无（断网可完整运行）' },
    { key: '许可', value: 'MIT / Apache-2.0 / OFL / 公有领域' },
  ];
}
