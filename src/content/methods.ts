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
        ${'2026-10-13'}（UTC）。轨道位置在构建数据包时解算一次，
        页面运行时不访问任何外部服务。
      </p>

      <div class="spec-grid">${specHtml}</div>

      <div class="method-folds">
        <details class="fold">
          <summary>作品定位、受众与使用场景</summary>
          <div class="fold-body">
            <p>
              这是一件<strong>数据可视化叙事作品</strong>，不是一个卫星追踪工具。
              它回答的是一个问题：近地轨道上的物体正在变成什么样子，为什么
              低处的会掉下来、高处的不会。目标受众是三类：
            </p>
            <ul>
              <li>
                <strong>普通公众与中学生。</strong>他们能读懂「四百公里」与
                「两分半到上海」，但没有任何人告诉他们一万六千个物体里
                大部分已经不工作了。作品用可点的球体承担这件事的入口。
              </li>
              <li>
                <strong>科普场馆与课堂。</strong>每一步都有一句结论、一台可操作的
                仪器与一个能复算的脚本。章节支持锚点链接，讲解时可以跳着放。
              </li>
              <li>
                <strong>同行与评审。</strong>他们需要的是口径、局限与复算路径，
                这些内容默认折叠，展开即可逐条核对，不干扰普通读者的阅读。
              </li>
            </ul>
            <p>
              传播场景是浏览器：桌面端与手机都能完整观看，无需安装、无需联网、
              不依赖任何外部接口。断网时用一个静态服务器即可完整运行，
              适合评审现场与展厅的离线环境。
            </p>
          </div>
        </details>

        <details class="fold">
          <summary>视觉编码与交互</summary>
          <div class="fold-body">
            <p>
              页面上的每个视觉变量都只承担一件事，且在图例里写明：
            </p>
            <ul>
              <li><strong>位置</strong>：地固坐标系中的真实位置，不是示意图形。</li>
              <li><strong>颜色</strong>：对象类别（第一章）或所属碎片事件（第三至五章）。两套编码不同，图例会随章节切换。</li>
              <li><strong>亮度</strong>：被选中的类别提亮，其余压暗，用于「只看一类」的对照。</li>
              <li><strong>明暗程度（淡影）</strong>：第二章的「尚未发射」。实心是当年已在轨，淡影是之后才出现的位置。</li>
              <li><strong>点的消失</strong>：第五章的时间外推。低层先消失，高层几乎不动。</li>
            </ul>
            <p>
              交互遵循「就地验证」的原则：正文里每一个可点的数字、图例上的每一行、
              仪器上的每一档，点下去都会改变球面，而不是弹出一段说明。
              全部筛选都可以用 <kbd>Esc</kbd> 一键撤销，当前生效的条件会
              显示在左上角图例下方。三维场景支持拖动旋转、方向键旋转、
              加减号缩放、双击或 <kbd>0</kbd> 复位。
            </p>
            <p>
              在「读」之外，页面还准备了三种「演」的方式，都直接作用于同一份点云：
            </p>
            <ul>
              <li>
                <strong>时间播放器</strong>：年份轴下方的播放键会让 1957—2026
                逐年推进，12 秒走完整条时间轴，可切换 0.5× / 1× / 2×；
                经过 2007、2009 两次编目跃升时会自动停顿，让观众看清事件发生的瞬间。
                <kbd>空格</kbd> 播放或暂停。
              </li>
              <li>
                <strong>时间对照</strong>：按 <kbd>C</kbd> 或点图例上的「时间对照」，
                画面被一条可拖动的中线切开，左半是 2015 年及以前发射、今天仍可定位的对象，
                右半是今天的全部编目；两侧读数随拖动实时更新，<kbd>Esc</kbd> 退出。
                这里比较的是「当年已上天、今天还在」与「今天全部」，不是两个年份的编目总数。
              </li>
              <li>
                <strong>讲解模式</strong>：按 <kbd>T</kbd> 或点「讲解」，
                页面按八个预设机位自动巡游全片，底部字幕给出每一步的看点，
                可暂停、前后翻步；滚轮或触摸滑动即退出自动播放，交还控制权。
                适合答辩现场无人操作时循环演示。
              </li>
            </ul>
            <p>
              每一章都有一个固定的锚点，例如 <code>#decay-projection</code>，
              可以直接打开、也可以从图例上复制。答辩时不必从第一屏滚起。
            </p>
          </div>
        </details>

        <details class="fold">
          <summary>原创贡献与 AI 工具使用</summary>
          <div class="fold-body">
            <p>
              本作的原创工作集中在四件事上，第三方资源只提供原始数据与基础库：
            </p>
            <ul>
              <li>
                <strong>选题与论证链。</strong>把「编目数」「可定位数」「清除速度」
                「外推」四件事串成一条可以逐步验证的链条，每一节都为下一节
                提供前提。这个结构不是任何现成作品已有的。
              </li>
              <li>
                <strong>视觉与交互设计。</strong>深空底色、单一强调色、直角面板、
                仪表式读数、可操作的仪器，整套视觉系统与交互模型由团队设计。
                页面不使用任何第三方图片素材。
              </li>
              <li>
                <strong>数据管线与可核验性。</strong>从原始 TLE 到页面读数的每一步
                都有脚本，79 项交叉核对全部通过。这是本作区别于「一张好看的图」
                的地方。
              </li>
              <li>
                <strong>工程实现。</strong>着色器内的筛选、确定性的碎片寿命取样、
                构建期解算、标注的屏幕投影与避让，都是为本作的具体问题写的，
                不是模板改造。
              </li>
            </ul>
            <p>
              <strong>AI 工具使用情况：</strong>开发过程中使用了大模型辅助代码编写
              与文案修订。选题、论证结构、数据口径的判断、视觉方案与最终取舍
              由团队确定；所有数字由项目内脚本从原始数据算出，不经过模型生成；
              全部代码在浏览器中实际运行验证。页面上的每一个读数都可以用
              <code>npm run verify</code> 复算，不依赖任何生成内容。
            </p>
          </div>
        </details>

        <details class="fold">
          <summary>页面内自检</summary>
          <div class="fold-body">
            <p>
              下面这组检查在浏览器里现场重算，与页面上的读数比对。它是
              <code>npm run verify</code> 的轻量子集，用于现场演示时快速证明
              「页面显示的数字与数据文件一致」，不需要打开终端。
            </p>
            <button class="self-check-btn mono" type="button" id="self-check">运行页面内自检</button>
            <ul class="self-check-list" id="self-check-list"></ul>
          </div>
        </details>        <details class="fold">
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
              公开的解析模型，也是 TLE 数据的配套算法。编目 ${int(f.located)} 个对象
              与三个碎片群共 ${int(18610)} 条根数，在构建数据包时按历元时刻各解算一次。
            </p>
            <p>
              之所以不在运行时解算：本地实测全量一次约 7 毫秒，而一帧的预算是
              16.7 毫秒，把它放进渲染循环会挤掉构图与交互的余量。本作的画面是
              历元时刻的一张切片，时间轴只改变「哪些对象被显示」，不改变它们各自的
              位置，因此构建期解算一次就足够，运行期只更新着色器的筛选常量。
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
          <summary>完成范围：已做与未做</summary>
          <div class="fold-body">
            <p>
              如实区分已完成、已测试与不在范围内三部分，避免把计划写成成果：
            </p>
            <p><strong>已完成并逐项验证：</strong></p>
            <ul>
              <li>五个章节、20 个叙事步骤，每步一句结论、一台可操作仪器、一个可点的数据块。</li>
              <li>${int(f.located)} 个编目对象与 ${int(f.debrisTotal)} 个碎片的三维点云，构建期 SGP4 解算，运行期只改筛选常量。</li>
              <li>七台仪器：对象构成尺、高度剖面尺、年份轴、近地点直方图、碎片群选择器、轨道面转盘、时间滑块。</li>
              <li>球上标注、比例尺、悬停探针、点选读数卡、常驻图例与筛选回显、章节锚点。</li>
              <li>79 项离线交叉核对脚本与 12 项页面内自检，全部通过。</li>
              <li>桌面 1440×900 与手机 390×844 实测：标注不越界、不压面板与页眉页脚，读数卡不出界。</li>
              <li>键盘可达：方向键旋转、加减号缩放、0 复位、仪器可用方向键与 Home/End 操作、Esc 撤销筛选。</li>
            </ul>
            <p><strong>已知未做（不在本作范围内，或数据不支持）：</strong></p>
            <ul>
              <li>不做实时追踪，不做碰撞预警，不做轨道机动仿真，不预测具体某一年发生什么。</li>
              <li>不包含厘米级以下不可跟踪碎片；这部分数量远大于编目数，但没有任何公开编目。</li>
              <li>不做三维地球贴图与实景卫星模型：那需要第三方纹理或模型资源，与本作「零外部素材、可完整离线」的取舍冲突。</li>
              <li>没有后端与账号系统：全部数据是冻结快照，页面状态只在本地，刷新即重置（章节锚点除外）。</li>
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
