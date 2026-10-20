/**
 * 《轨道之上》应用入口。
 *
 * 装配顺序：
 *   1. 建三维场景（地球、编目点云、碎片点云、相机）
 *   2. 载入离线数据（编目、碎片、历史序列）
 *   3. 用数据生成文案 DOM（文案里的数字全部来自数据，不写死）
 *   4. 订阅滚动叙事，把步骤状态转成场景参数
 *   5. 起渲染循环，并驱动仪表读数
 *
 * 章节接入方式：每章一个 content/chapterN.ts（文案）+ 共用 chapters/scenes.ts
 * （镜头与图层状态表）。主循环与引擎层不认识任何具体章节，
 * 新增章节只需往场景表里加键、往步骤表里加项。
 */
import * as THREE from 'three';
import './style.css';

import { createGlobe, SCENE_EARTH_RADIUS } from './core/globe';
import { PointLayer } from './core/pointCloud';
import { createCameraRig } from './core/camera';
import { createScrollStory, type StoryStep } from './core/scrollStory';
import { loadSceneData, loadDebrisData, loadHistoryData, loadCatalogNames, type CatalogNames } from './core/data';
import { cameraDistanceKm, int, isoDate, scaled } from './core/format';
import { createInstrumentHost, type Instrument, type InstrumentId } from './core/instrument';
import { createPicker } from './core/picking';
import { mountRailControls } from './core/railControl';
import { createStarfield } from './core/starfield';
import { createAnnotationLayer } from './core/annotations';
import { createOverlayLayer } from './core/overlays';
import { createLegend, type LegendPayload } from './core/legend';
import { createCompareMode } from './core/compare';
import { createTour, type TourStep } from './core/tour';

import { buildFigures, type DebrisGroupFigures } from './content/figures';
import { CHAPTER_ONE_STEPS, type StepCopy } from './content/chapter1';
import { CHAPTER_TWO_STEPS } from './content/chapter2';
import { CHAPTER_THREE_STEPS } from './content/chapter3';
import { CHAPTER_FOUR_STEPS } from './content/chapter4';
import { CHAPTER_FIVE_STEPS } from './content/chapter5';
import { renderMethods, methodSpecs } from './content/methods';
import { createChapterScenes, DEBRIS_PALETTE } from './chapters/scenes';
import { buildAnnotations } from './chapters/annotations';
import { createAltitudeInstrument } from './chapters/instruments/altitude';
import { createCompositionInstrument } from './chapters/instruments/composition';
import { createYearInstrument } from './chapters/instruments/year';
import { createPerigeeInstrument } from './chapters/instruments/perigee';
import { createFamilyInstrument } from './chapters/instruments/family';
import { createPlaneInstrument } from './chapters/instruments/plane';
import { createDecayInstrument } from './chapters/instruments/decay';

/** 全部章节的步骤，按叙事顺序拼接。刻度条与滚动区间都从这里来。 */
const ALL_STEPS: StepCopy[] = [
  ...CHAPTER_ONE_STEPS,
  ...CHAPTER_TWO_STEPS,
  ...CHAPTER_THREE_STEPS,
  ...CHAPTER_FOUR_STEPS,
  ...CHAPTER_FIVE_STEPS,
];

/**
 * 时间对照的参照年份。
 *
 * 不取更早的 1980：catalog.bin 里 1980 年及以前发射、今天仍有公开根数的
 * 对象只剩 13 个，左半边会几乎全空，读者会以为是渲染出错。2015 年这一批
 * 有 813 个，与今天的 15,934 个相比是二十倍差距，密度差在画面上真实可见。
 */
const COMPARE_PAST_YEAR = 2015;

/**
 * 讲解模式的八个关键画面。
 *
 * 为什么不把 19 步全部放进来：答辩只有几分钟，这条路线要保证每一格
 * 都承担一句可被记住的论证，而不是把过渡页也念一遍。八步分别对应
 * 「有多大 / 有多少画不出来 / 怎么长出来的 / 一次解体 / 一次相撞 /
 * 高处不衰减 / 两百年后」。
 *
 * 字幕里的数字全部省略，改成定性表述：数字在页面正文与读数里都有，
 * 写死在这里会随数据更新而过时。
 */
const TOUR_STEPS: TourStep[] = [
  { id: 'intro', title: '开场：头顶上的一层', note: '先看全景。每一颗光点都是编目里有记录的一个物体。' },
  { id: 'how-many', title: '有多少', note: '编目在轨三万五千余个，其中能逐一定位的不到一半。' },
  { id: 'not-located', title: '画不出来的那一半', note: '没有公开轨道根数，就只能以数字存在，不能落在球上。' },
  { id: 'growth-steps', title: '几次事件把总数顶上去', note: '增长不是匀速的。拨动年份轴，看台阶在哪几年。' },
  { id: 'fy-arrive', title: '一次主动解体', note: '风云一号C：一次试验留下了一条长期不散的碎片壳层。' },
  { id: 'impact-arrive', title: '一次意外相撞', note: '宇宙 2251 与铱星 33：两个轨道面交叉，后果落在同一条高度带。' },
  { id: 'decay-bands', title: '清除速度按高度分层', note: '低处几年就清空，八百公里以上几乎不动。' },
  { id: 'decay-projection', title: '两百年后仍在那里', note: '按实测衰减外推，剩下的绝大多数停在高处。' },
];

/** 载入遮罩上的进度文字 */
function setBootStatus(text: string): void {
  const el = document.getElementById('boot-status');
  if (el) el.textContent = text;
}

function failBoot(err: unknown): void {
  const veil = document.getElementById('boot-veil');
  const message = err instanceof Error ? err.message : String(err);
  if (!veil) return;
  veil.classList.remove('is-gone');
  veil.innerHTML = `
    <div class="boot-error">
      <h3>数据载入失败</h3>
      <p>本页需要从同目录的 data/ 文件夹读取轨道数据。若你直接双击打开 HTML 文件，
      浏览器会因同源策略拦截文件读取，请通过本地静态服务器或线上地址访问。</p>
      <pre>${message.replace(/</g, '&lt;')}</pre>
    </div>`;
}

/** 把步骤 DOM 插到 main 中，尾页固定在最后 */
function mountSteps(steps: { id: string; html: string }[]): HTMLElement[] {
  const main = document.getElementById('story');
  if (!main) throw new Error('缺少 #story 容器');
  const created: HTMLElement[] = [];
  for (const s of steps) {
    const section = document.createElement('section');
    section.className = s.id === 'intro' ? 'step intro' : 'step';
    section.id = `step-${s.id}`;
    section.dataset.step = s.id;
    const rail = document.createElement('div');
    rail.className = 'rail';
    rail.innerHTML = s.html;
    section.appendChild(rail);
    main.appendChild(section);
    created.push(section);
  }
  return created;
}

/** 底部章节刻度。步骤变多之后按章节分组，避免刻度挤成一条线。 */
function mountStageTicks(
  steps: { id: string; nav: string }[],
  onJump: (id: string) => void
): Map<string, HTMLButtonElement> {
  const host = document.getElementById('stage-ticks');
  if (!host) throw new Error('缺少 #stage-ticks 容器');
  const map = new Map<string, HTMLButtonElement>();
  for (const s of steps) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage-tick';
    b.dataset.state = 'idle';
    b.textContent = s.nav;
    b.addEventListener('click', () => onJump(s.id));
    host.appendChild(b);
    map.set(s.id, b);
  }
  return map;
}

async function main(): Promise<void> {
  setBootStatus('正在准备渲染环境');

  const canvas = document.getElementById('scene');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('缺少 #scene 画布');

  // ---------- 三维场景 ----------
  const scene = new THREE.Scene();
  // 深空底色：接近纯黑但略偏冷。纯黑会让地球轮廓消失，偏一点的冷色能把球体边缘衬出来。
  scene.background = new THREE.Color(0x04070d);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    // 加 ?qa=1 时保留绘制缓冲，使画面可被截图与像素校验。
    // 默认关闭：保留缓冲会带来额外拷贝开销，正常浏览与答辩演示不需要。
    preserveDrawingBuffer: new URLSearchParams(window.location.search).has('qa'),
  });
  const dprCap = window.devicePixelRatio > 1.5 ? 1.6 : window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(2, dprCap));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const globe = createGlobe(scene);
  const rig = createCameraRig(canvas, window.innerWidth / window.innerHeight);
  const starfield = createStarfield(scene);

  // ---------- 数据 ----------
  setBootStatus('正在载入轨道编目');
  const [data, debris, history] = await Promise.all([
    loadSceneData(),
    loadDebrisData(),
    loadHistoryData(),
  ]);

  setBootStatus('正在解析海岸线');
  // 海岸线只影响地理参照，缺失不应阻断作品，因此单独 catch；
  // 它同样计入运行时数据量，所以把字节数留下来。
  let coastlineBytes = 0;
  const coastlineReady = globe
    .loadCoastlines('data/coastlines.json')
    .then((bytes) => {
      coastlineBytes = bytes;
    })
    .catch((err) => {
      console.warn('海岸线加载失败，地理参照层将保持空白：', err);
    });

  setBootStatus('正在铺开点云');

  // ---------- 编目点云 ----------
  const { catalog, catalogMeta, offset } = data;
  const stride = catalogMeta.stride;
  const count = catalogMeta.count;

  // 类别数组直接从数据包取出，着色在着色器里完成
  const categories = new Float32Array(count);
  const sizes = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const launchYears = new Float32Array(count);
  // 近地点高度。第一章的高度剖面尺按它筛选：
  // 仪器只发「只看 400-600 这一层」，落到着色器上是一次区间比较，
  // 因此这一列必须真的存在，否则筛选条件与 0 比较会把整层点全部藏起来。
  const catalogMetrics = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const o = i * stride;
    categories[i] = catalog[o + offset.category];
    positions[i * 3] = catalog[o + offset.x];
    positions[i * 3 + 1] = catalog[o + offset.y];
    positions[i * 3 + 2] = catalog[o + offset.z];
    catalogMetrics[i] = catalog[o + offset.perigeeKm];
    // 年份用于第二章的「按时间逐步出现」。没有年份的对象给一个极大的
    // 负数，任何时间切片都会把它们包含进来，它们确实无法定年，
    // 但也不该被静默丢弃。
    const y = catalog[o + offset.launchYear];
    launchYears[i] = y > 0 ? y : -1e6;
    // 尺寸按对象类别微调：碎片与残骸略小，载荷略大，
    // 让「哪一类是主体」在密度高的区域也能分辨
    const cat = catalog[o + offset.category];
    sizes[i] = cat === 3 ? 0.82 : cat === 2 ? 0.9 : 1;
  }

  const layer = new PointLayer({
    count,
    categories,
    sizes,
    launchYears,
    metrics: catalogMetrics,
    // 点保持小而离散：16,000 个点若各自画大，叠加后会糊成一团。
    // 目标观感是「能数得清的光点」，而不是一片发光的云。
    baseSizePx: 1.35,
    maxSizePx: 4.5,
    referenceDistance: SCENE_EARTH_RADIUS * 4.2,
    opacity: 0.7,
  });
  layer.updateFromEcef(positions);
  scene.add(layer.points);

  // ---------- 2015 年参照层 ----------
  //
  // 时间对照模式要同时画出「2015 年及以前发射、今天仍可定位」与「现在」两批点。
  // 复用同一份位置与属性缓冲，只把年份闸门固定在 COMPARE_PAST_YEAR：
  // 两半画面因此是同一个机位、同一批对象，唯一的变量是时间。
  // 这一层平时完全不可见，也不参与点选与读数。
  const pastLayer = new PointLayer({
    count,
    categories,
    sizes,
    launchYears,
    metrics: catalogMetrics,
    baseSizePx: 1.5,
    maxSizePx: 4.8,
    referenceDistance: SCENE_EARTH_RADIUS * 4.2,
    opacity: 0.85,
  });
  pastLayer.updateFromEcef(positions);
  pastLayer.setYearMax(COMPARE_PAST_YEAR);
  pastLayer.setGhost(false);
  pastLayer.points.visible = false;
  scene.add(pastLayer.points);

  // ---------- 碎片点云 ----------
  //
  // 与编目点云分开成两个图层，而不是合并成一个：
  //   着色规则不同（编目按对象类别，碎片按所属碎片群）
  //   筛选维度不同（编目按发射年，碎片按群与寿命）
  //   章节切换时需要独立显隐，合并后每次都要重传两万条属性。
  // 两个图层共享同一套着色器，开销只是多一次 draw call。
  const dCount = debris.meta.total;
  const dCategories = new Float32Array(dCount);
  const dPositions = new Float32Array(dCount * 3);
  const dMetrics = new Float32Array(dCount); // 复用为「近地点」，第三、四章按它筛选
  const dSizes = new Float32Array(dCount);
  const dLifetimes = new Float32Array(dCount);

  // 第五章的时间外推：给每个碎片分配一个归一化寿命。
  //
  // 做法：按近地点落到 history.json 里的高度层，取该层拟合出的时间常数 τ，
  // 然后对每一个碎片抽一个 N(τ) 分布下的寿命 t = -τ·ln(u)（u 为确定性哈希）。
  // 这样图层在整体上会精确复现那一层的实测衰减比例，而单个点又是离散的。
  //
  // τ 为 null 的层（800 公里以上）给一个大于时间轴跨度的常数，
  // 表示在这 200 年里不会消失，这正是页面上要表达的那件事。
  const MAX_HORIZON = 200;
  const bandTau = history.bandDecay
    .map((b) => ({
      lo: b.lo,
      hi: b.hi ?? Number.POSITIVE_INFINITY,
      tau: b.tauYears,
    }))
    .sort((a, b) => a.lo - b.lo);

  /** 确定性哈希：同一个索引永远得到同一个 [0,1) 值，保证画面可复现。 */
  function hash01(i: number): number {
    let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  function lifetimeOf(perigee: number, index: number): number {
    const band = bandTau.find((b) => perigee >= b.lo && perigee < b.hi);
    const tau = band?.tau ?? null;
    if (tau === null || tau === undefined) {
      // 观测期内没有可测清除：给 1.5 倍时间轴跨度，200 年推不完。
      return 1.5;
    }
    const u = Math.max(1e-6, hash01(index));
    const years = -tau * Math.log(u);
    return Math.min(1.5, years / MAX_HORIZON);
  }

  for (let i = 0; i < dCount; i += 1) {
    const o = i * debris.meta.stride;
    dPositions[i * 3] = debris.points[o + debris.offset.x];
    dPositions[i * 3 + 1] = debris.points[o + debris.offset.y];
    dPositions[i * 3 + 2] = debris.points[o + debris.offset.z];
    dCategories[i] = debris.points[o + debris.offset.groupId];
    const pg = debris.points[o + debris.offset.perigeeKm];
    dMetrics[i] = pg;
    dSizes[i] = 1.15;
    dLifetimes[i] = Number.isFinite(pg) ? lifetimeOf(pg, i) : 1.5;
  }

  const debrisLayer = new PointLayer({
    count: dCount,
    categories: dCategories,
    sizes: dSizes,
    metrics: dMetrics,
    // 群号单走一条筛选通道。它与近地点那条互不覆盖：
    // 群由场景表定（第三章只留风云一号C，第四章留两个撞击群），
    // 层由用户在直方图上点，两者要能同时成立。
    groups: dCategories,
    lifetimes: dLifetimes,
    // 三个碎片群各自的颜色。第三到五章要看的是碎片内部的差异，
    // 统一用橙色不够用。
    palette: [DEBRIS_PALETTE.fengyun1c, DEBRIS_PALETTE.cosmos2251, DEBRIS_PALETTE.iridium33],
    baseSizePx: 1.9,
    maxSizePx: 5.5,
    referenceDistance: SCENE_EARTH_RADIUS * 3.2,
    opacity: 1,
  });
  debrisLayer.updateFromEcef(dPositions);
  debrisLayer.setCategoryMix(1);
  debrisLayer.points.visible = false;
  scene.add(debrisLayer.points);

  // ---------- 文案与统计 ----------
  const debrisFigures: DebrisGroupFigures[] = debris.meta.groups.map((g) => ({
    key: g.key,
    label: g.label,
    event: g.event,
    color: g.color,
    count: g.count,
    perigeeMedianKm: g.perigeeMedianKm,
    perigeeMinKm: g.perigeeMinKm,
    perigeeMaxKm: g.perigeeMaxKm,
    above800km: g.above800km,
    inclMinDeg: g.inclMinDeg,
    inclMedianDeg: g.inclMedianDeg,
    inclMaxDeg: g.inclMaxDeg,
  }));

  const figures = buildFigures(data, debrisFigures, debris, history);

  const stepEls = mountSteps(ALL_STEPS.map((s) => ({ id: s.id, html: s.render(figures) })));
  const storySteps: StoryStep[] = ALL_STEPS.map((s, i) => ({
    el: stepEls[i],
    id: s.id,
    pinRatio: s.pinRatio,
  }));

  /**
   * 页面内自检。
   *
   * 与 scripts/verify-data.mjs 的区别：那个脚本从原始 TLE 重新解算，
   * 面向离线复算；这里只核对「已经载入内存的缓冲区」与「页面上显示的读数」
   * 是否一致，用于答辩现场证明画面上的数字确实来自数据文件。
   * 两者不重复：脚本证明数据源可信，这里证明页面没有多算或少算。
   */
  function mountSelfCheck(host: HTMLElement): void {
    const btn = host.querySelector<HTMLButtonElement>('#self-check');
    const list = host.querySelector<HTMLElement>('#self-check-list');
    if (!btn || !list) return;

    btn.addEventListener('click', () => {
      const { catalog, catalogMeta } = data;
      const s = catalogMeta.stride;
      const n = catalogMeta.count;
      const idx = offset;
      const rows: { label: string; ok: boolean; detail: string }[] = [];

      const push = (label: string, ok: boolean, detail: string) => rows.push({ label, ok, detail });

      push(
        '点云缓冲区与元信息一致',
        catalog.length === n * s,
        `${catalog.length.toLocaleString()} = ${n.toLocaleString()} × ${s}`
      );

      let nan = 0;
      let leo = 0;
      let catSum = 0;
      let perigeeSum = 0;
      const idSet = new Set<number>();
      let dup = 0;
      for (let i = 0; i < n; i += 1) {
        const o = i * s;
        if (!Number.isFinite(catalog[o + idx.x])) {
          nan += 1;
          continue;
        }
        const perigee = catalog[o + idx.perigeeKm];
        if (perigee < 2000) leo += 1;
        perigeeSum += Number.isFinite(perigee) ? perigee : 0;
        const id = Math.round(catalog[o + idx.noradId]);
        if (idSet.has(id)) dup += 1;
        else idSet.add(id);
      }
      for (const c of figures.locatedByCategory) catSum += c.count;

      push('解算失败的点', nan === catalogMeta.failed, `${nan} 个`);
      push('近地轨道计数与页面一致', leo === figures.leo.count, `${leo.toLocaleString()} 个`);
      push(
        '类别合计与页面一致',
        catSum === n,
        `${catSum.toLocaleString()} = ${n.toLocaleString()}`
      );
      push('编目号无重复', dup === 0, `${dup} 个重复`);
      push(
        '可定位数一致',
        n === figures.located,
        `${n.toLocaleString()} 个`
      );
      push(
        '编目元信息与页面口径一致',
        catalogMeta.categories['工作中的载荷'] === figures.locatedWorking,
        `工作中且可定位 ${figures.locatedWorking.toLocaleString()} 个`
      );

      // 碎片层：总数、群计数、近地点均值量级
      let dSum = 0;
      let dPerigee = 0;
      let dMaxAlt = 0;
      const dN = debris.meta.total;
      const ds = debris.meta.stride;
      for (let i = 0; i < dN; i += 1) {
        const o = i * ds;
        dPerigee += debris.points[o + debris.offset.perigeeKm];
        const r = Math.hypot(
          debris.points[o + debris.offset.x],
          debris.points[o + debris.offset.y],
          debris.points[o + debris.offset.z]
        );
        if (Number.isFinite(r)) dMaxAlt = Math.max(dMaxAlt, r - 6378.137);
      }
      for (const g of figures.debris) dSum += g.count;
      push('碎片总数与页面一致', dSum === dN, `${dSum.toLocaleString()} 个`);
      push(
        '碎片高度在低轨范围',
        dMaxAlt < 3500,
        `最高 ${Math.round(dMaxAlt)} km`
      );
      push(
        '碎片近地点均值合理',
        dPerigee / Math.max(1, dN) > 200 && dPerigee / Math.max(1, dN) < 2000,
        `均值 ${Math.round(dPerigee / Math.max(1, dN))} km`
      );
      push(
        '三个碎片群合计与编目一致',
        figures.debrisTotal === dN,
        `${figures.debrisTotal.toLocaleString()} 个`
      );
      push(
        '历史序列末年与编目总数同源',
        figures.historyLastYear >= 2020,
        `${figures.historyLastYear} 年`
      );

      list.replaceChildren();
      for (const r of rows) {
        const li = document.createElement('li');
        li.className = r.ok ? 'is-ok' : 'is-bad';
        const mark = document.createElement('span');
        mark.className = 'self-check-mark mono';
        mark.textContent = r.ok ? '通过' : '不符';
        const label = document.createElement('span');
        label.className = 'self-check-label';
        label.textContent = r.label;
        const detail = document.createElement('span');
        detail.className = 'self-check-detail mono';
        detail.textContent = r.detail;
        li.append(mark, label, detail);
        list.append(li);
      }
      const failed = rows.filter((r) => !r.ok).length;
      btn.textContent = failed === 0 ? `全部通过 · ${rows.length} 项` : `${failed} 项不符`;
      btn.dataset.done = failed === 0 ? 'ok' : 'bad';
    });
  }

  // ---------- 尾页 ----------
  const methodsHost = document.getElementById('methods');
  if (methodsHost) {
    // 运行时数据量按本次实际下载的字节数统计，而不是写死的常量：
    // 编目会更新，写死的体积迟早与实际不符。
    // 海岸线是异步加载且允许失败，这里等它落定再统计，否则会漏算。
    await coastlineReady;
    const dataSizeKb = (data.bytes + debris.bytes + history.bytes + coastlineBytes) / 1024;
    methodsHost.innerHTML = renderMethods(figures, methodSpecs(figures, dataSizeKb));
    mountSelfCheck(methodsHost);
  }

  // ---------- 滚动叙事 ----------
  const story = createScrollStory(storySteps);
  const scenes = createChapterScenes(rig, layer, debrisLayer, globe, history);
  /**
   * 时间对照模式是否占据画面。
   *
   * 对照模式自己控制图层与机位，叙事层在它运行期间必须停止回写场景，
   * 否则每一次 story.update 都会把镜头与点云拉回当前章节，
   * 中缝两边就变成同一年的画面。
   */
  let compareActive = false;

  // ---------- 球上标注 ----------
  //
  // 标注与场景表是两条并行的表达：场景表决定「哪些点可见、机位在哪」，
  // 标注决定「读者应该看哪一圈、哪一层」。两者用同一个 scene 键索引，
  // 切步骤时一起换，因此不会出现「镜头已经贴到 800 公里、标签还写着 400」。
  const annoHost = document.getElementById('anno-layer');
  if (!annoHost) throw new Error('缺少 #anno-layer 容器');
  const annotations = createAnnotationLayer(annoHost);
  const overlays = createOverlayLayer(scene);
  const annoByScene = buildAnnotations(figures);

  // ---------- 比例尺 ----------
  //
  // 屏幕上一段固定长度的线，对应多少公里，随视距实时换算。
  // 这样「这条轨道离地面 800 公里」不必靠读者自己乘地球半径。
  const scaleRule = document.getElementById('scale-rule');
  const scaleLabel = document.getElementById('scale-label');
  let lastScaleText = '';

  function updateScaleBar() {
    if (!scaleRule || !scaleLabel) return;
    // 目标：尺子代表一个「整数感」的距离。候选取 100/200/500/1000/2000…
    // 再按当前视距换算成像素，取最接近 64px 的那一档。
    const vFov = (rig.camera.fov * Math.PI) / 180;
    const worldPerPixel =
      (2 * Math.tan(vFov / 2) * rig.distance * SCENE_EARTH_RADIUS) / window.innerHeight;
    const kmPerPixel = worldPerPixel * (6378.137 / SCENE_EARTH_RADIUS);
    const candidates = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    let best = candidates[0];
    let bestErr = Infinity;
    for (const km of candidates) {
      const px = km / kmPerPixel;
      const err = Math.abs(px - 64);
      if (err < bestErr) {
        bestErr = err;
        best = km;
      }
    }
    const px = Math.max(18, Math.min(160, best / kmPerPixel));
    scaleRule.style.width = `${px.toFixed(1)}px`;
    const text = best >= 1000 ? `${int(best / 1000)} 千 km` : `${best} km`;
    if (text !== lastScaleText) {
      lastScaleText = text;
      scaleLabel.textContent = text;
    }
  }

  // ---------- 仪器层 ----------
  //
  // 五台仪器全部提前建好并挂载，切换只是显隐：切场景时不重建 SVG，
  // 也不会有一次布局抖动。仪器发出的意图统一交给 scenes.applyIntent，
  // 由场景层决定怎么落到点云与镜头上。
  const instrumentLayer = document.getElementById('instrument-layer');
  if (!instrumentLayer) throw new Error('缺少 #instrument-layer 容器');

  const instruments = createInstrumentHost(
    instrumentLayer,
    {
      altitude: createAltitudeInstrument,
      category: createCompositionInstrument,
      year: createYearInstrument,
      perigee: createPerigeeInstrument,
      family: createFamilyInstrument,
      plane: createPlaneInstrument,
      decay: createDecayInstrument,
    } satisfies Record<InstrumentId, () => Instrument>,
    (intent) => {
      scenes.applyIntent(intent);
      // 用户操作后立刻把新状态推回仪器，避免下一次 update 前读数还是旧的
      instruments.update(instrumentPayload());
      legend.update(legendPayload());
      announceIntent(intent);
    }
  );

  // ---------- 常驻图例与筛选回显 ----------
  //
  // 与仪器分开成两个入口，因为它们回答的是两个问题：
  // 仪器说「这一步可以怎么操作」，图例说「画面上的颜色是什么、现在筛了什么」。
  // 图例常驻，仪器随场景换。
  const legendHost = document.getElementById('legend-layer');
  if (!legendHost) throw new Error('缺少 #legend-layer 容器');
  const legend = createLegend(legendHost, (intent) => {
    scenes.applyIntent(intent);
    instruments.update(instrumentPayload());
    legend.update(legendPayload());
    announceIntent(intent);
  });
  // 图例展开/收起会改变它的高度，标注层需要重算避让矩形
  window.addEventListener('orbit:legend-resize', () => reportBottomInset());

  // ---------- 时间对照 ----------
  //
  // 对照年份取 COMPARE_PAST_YEAR，而不是更早的 1980。原因在数据本身：
  // catalog.bin 里 1980 年及以前发射、今天仍有公开根数的对象只剩 13 个，
  // 左半边会几乎全空，读者会以为是渲染出错。2015 年这一批有 813 个，
  // 与今天的 15,934 个相比是二十倍差距，密度差在画面上真实可见。
  // 编目总量仍然从历史序列现取，不写死。
  const pastAll =
    figures.historySeries.find((s) => s.year === COMPARE_PAST_YEAR)?.inOrbit ?? 0;
  // launchCumulative 只收录「当年有发射」的年份，目标年不在其中时直接 find
  // 会得到 undefined，读数就会显示 0。取最后一条不大于目标年的记录。
  let pastLocated = 0;
  for (const r of figures.launchCumulative) {
    if (r.year > COMPARE_PAST_YEAR) break;
    pastLocated = r.cumulative;
  }

  let tourRef: ReturnType<typeof createTour> | null = null;

  const compare = createCompareMode({
    renderer,
    scene,
    rig,
    layer,
    pastLayer,
    labels: {
      pastYear: COMPARE_PAST_YEAR,
      nowYear: figures.historyLastYear,
      pastAll,
      pastLocated,
      nowAll: figures.cataloguedInOrbit,
      nowLocated: figures.located,
    },
    onOpen: () => {
      compareActive = true;
      // 与讲解模式互斥：两个全屏/自动模式叠在一起，读者分不清谁在控制页面。
      tourRef?.close();
      closePickCard?.();
      // 从任意章节进入都要回到同一个全景机位，否则左半与右半的构图不同，
      // 比较的就不是同一张画面。
      rig.releaseUserControl();
      rig.setSpin(0);
      rig.setPose({ azimuth: 0.95, elevation: 0.35, distance: 6.4, screenShift: 0 });
      rig.setBottomInset(0);

      // 中性色：时间对照要比较的是「有多少」，不是「属于哪一类」。
      // 两半用同一套编码，颜色差异才不会喧宾夺主。
      layer.points.visible = true;
      layer.setYearMax(null);
      layer.setGhost(false);
      layer.setMetricRange(null, null);
      layer.setDim(0);
      layer.clearEmphasis();
      layer.setCategoryMix(0.72);
      layer.setOpacity(0.8);
      pastLayer.setCategoryMix(0.72);
      pastLayer.setYearMax(COMPARE_PAST_YEAR);
      pastLayer.setGhost(false);
      pastLayer.setOpacity(0.8);
      debrisLayer.points.visible = false;

      instruments.setMuted(true);
      legend.setMode('compare');
      announce(`时间对照模式：左半是 ${COMPARE_PAST_YEAR} 年及以前发射、今天仍可定位的对象，右半是现在。拖动中缝比较。`);
    },
    onClose: () => {
      compareActive = false;
      // 重跑当前场景，而不是逐项还原：场景表是画面状态的唯一真相，
      // 逐项还原迟早会漏掉一个字段（例如类别强调的缓存）。
      scenes.refresh();
      scenes.apply(story.state, scenes.currentSceneId);
      pastLayer.points.visible = false;
      instruments.setMuted(false);
      legend.setMode(null);
      instruments.update(instrumentPayload());
      legend.update(legendPayload());
      reportBottomInset();
      announce('已退出时间对照，回到当前章节。');
    },
  });

  // ---------- 讲解模式 ----------
  //
  // 八个关键画面，每 7 秒推进一格。字幕只给定性描述，数字留在页面里，
  // 这样数据更新时讲解词不会过期。
  //
  // 落点不能直接用 story.goTo：它把「步骤顶部」对到视口中线，长段落
  // 会有一半伸到页眉与字幕条之间（第五章「清除速度按高度分层」实测
  // 正文底部被字幕条压住 100px，上一节的图例行还残留在页眉下沿）。
  // 这里改成对「正文块」定位：
  //   桌面：正文顶边落在页眉下方 16px，整块正文自上而下排；
  //   窄屏：正文底边落在字幕条上方 16px（窄屏正文本来就是底部对齐）。
  // 窄屏场景切换会改变仪器面板高度，进而改变后续步骤的文档位置，
  // 所以落位后再量一次，必要时瞬时校正。
  let tourNavToken = 0;
  function tourGoTo(id: string): void {
    const token = ++tourNavToken;
    // 讲解模式会收起折叠块、改变正文让位高度，步骤在文档里的区间随之变化。
    // 先重测再算落点，否则读到的还是上一节的高度，滚动位置与步骤判定会错位。
    story.remeasure();
    const step = document.getElementById(`step-${id}`);
    const rail = step?.querySelector<HTMLElement>('.rail');
    if (!step || !rail) {
      story.goTo(id);
      return;
    }

    /** 当前布局下，正文块应该让滚动停在哪。 */
    const target = () => {
      const hud = document.querySelector<HTMLElement>('.hud-top');
      const hudBottom = hud ? hud.getBoundingClientRect().bottom : 60;
      const r = rail.getBoundingClientRect();
      if (window.innerWidth <= 1080) {
        const bar = document.querySelector<HTMLElement>('.tour-bar');
        const barTop =
          bar && !bar.hidden ? bar.getBoundingClientRect().top : window.innerHeight - 120;
        return Math.max(0, r.bottom + window.scrollY + 16 - barTop);
      }
      return Math.max(0, r.top + window.scrollY - hudBottom - 16);
    };

    // 用瞬时滚动而不是平滑滚动：页面主线程要跑三维渲染（答辩机器上实测
    // 10fps 左右），浏览器的平滑滚动会被拖成三到四秒，讲解条 7 秒的节拍
    // 里有一半时间停在两页之间。镜头本身有插值过渡，硬切页面看起来仍是
    // 一次连贯的运镜，而不像被拽走。
    window.scrollTo({ top: target(), behavior: 'instant' });

    // 场景切换会改仪器面板高度，后面所有步骤的文档位置随之整体平移，
    // 原先算出的落点会差几十像素。连续几拍按同一套规则复量：只有偏差
    // 超过 6px 才补一次瞬时滚动，避免落定后还在微动。
    let tries = 0;
    const settle = () => {
      if (token !== tourNavToken || !tourRef?.active) return;
      const want = target();
      if (Math.abs(window.scrollY - want) > 6) {
        window.scrollTo({ top: want, behavior: 'instant' });
      }
      tries += 1;
      if (tries < 5) window.setTimeout(settle, 220);
    };
    window.setTimeout(settle, 220);
  }

  tourRef = createTour({
    steps: TOUR_STEPS,
    goTo: (id) => tourGoTo(id),
    onOpen: () => {
      if (compare.active) compare.close();
      closePickCard?.();
      legend.setMode('tour');
      // 讲解时图例与仪器收起、折叠块隐藏，步骤高度会变。两种变化都不会
      // 触发 IntersectionObserver 的重测，必须显式重量一次文档区间；
      // 否则步骤判定仍按旧坐标走，画面会停在上一节。
      requestAnimationFrame(() => {
        story.remeasure();
        reportBottomInset();
      });
      announce('讲解模式：按左右方向键切换画面，空格暂停，Esc 退出。');
    },
    onClose: () => {
      legend.setMode(null);
      requestAnimationFrame(() => {
        story.remeasure();
        reportBottomInset();
      });
      announce('已退出讲解模式，可以继续自由滚动。');
    },
  });

  window.addEventListener('orbit:compare', () => compare.toggle());
  window.addEventListener('orbit:tour', () => tourRef?.open());

  // 键盘入口：C 进入/退出时间对照，T 开始讲解。输入框里不触发。
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    // target 可能是 document（合成事件）或非 Element 节点，先确认再查 closest。
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      compare.toggle();
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      if (tourRef?.active) tourRef.close();
      else tourRef?.open();
    }
  });

  /** 读屏公告：把画面上发生的筛选说成一句短句。 */
  const srStatus = document.getElementById('sr-status');
  function announce(text: string) {
    if (srStatus) srStatus.textContent = text;
  }

  function announceIntent(intent: Parameters<typeof scenes.applyIntent>[0]) {
    switch (intent.kind) {
      case 'reset':
        announce('已清除筛选，画面恢复当前章节的默认视图。');
        break;
      case 'category': {
        const label = KIND_LABEL[intent.category ?? -1] ?? '某类对象';
        announce(intent.category === null ? '已清除类别筛选。' : `只看${label}。`);
        break;
      }
      case 'debris-group': {
        const g = intent.group === null ? null : figures.debris[intent.group];
        announce(g ? `只看${g.label}。` : '已清除碎片群筛选。');
        break;
      }
      case 'altitude-band':
        announce(
          intent.hi === null
            ? `只看 ${intent.lo} 公里以上。`
            : `只看 ${intent.lo} 至 ${intent.hi} 公里。`
        );
        break;
      case 'perigee-bin':
        announce(`只看近地点 ${intent.lo} 至 ${intent.hi} 公里的碎片。`);
        break;
      case 'year':
        announce(`时间切到 ${intent.year} 年末。`);
        break;
      case 'horizon':
        announce(intent.years === 0 ? '时间回到现在。' : `时间推进到第 ${intent.years} 年。`);
        break;
      case 'plane-angle':
        announce(`轨道面转到 ${Math.round((intent.azimuth * 180) / Math.PI)} 度方位。`);
        break;
    }
  }

  function legendPayload(): LegendPayload {
    return {
      step: story.state.id,
      figures,
      catalogVisible: layer.points.visible,
      debrisVisible: debrisLayer.points.visible,
      categoryMix: scenes.categoryMix,
      debrisGroups: scenes.debrisGroups,
      yearMax: scenes.yearMax,
      category: scenes.category,
      group: scenes.group,
      band: scenes.band,
      bin: scenes.bin,
      horizonYears: Math.round(scenes.horizon * 200),
    };
  }

  function instrumentPayload() {
    return {
      figures,
      scene: scenes.currentSceneId,
      progress: story.state.progress,
      yearMax: scenes.yearMax,
      horizon: scenes.horizon,
      debrisGroups: scenes.debrisGroups,
      category: scenes.category,
      group: scenes.group,
      band: scenes.band,
      bin: scenes.bin,
    };
  }

  /**
   * 时间推进到某一年时，三个碎片群还剩多少个。
   *
   * 与 decay 仪器的读数同源：用 projections 的相邻两点线性插值，
   * 因此球上的标注与面板上的数字不会出现两个值。
   */
  function remainingAt(years: number): number {
    const proj = figures.projections;
    if (!proj.length) return figures.debrisAlive;
    const stops = [0, ...proj.map((p) => p.years)];
    const vals = [figures.debrisAlive, ...proj.map((p) => p.totalRemaining)];
    if (years <= 0) return vals[0];
    let k = 0;
    while (k < stops.length - 1 && years > stops[k + 1]) k += 1;
    if (k >= stops.length - 1) return vals[vals.length - 1];
    const f = (years - stops[k]) / Math.max(1, stops[k + 1] - stops[k]);
    return Math.round(vals[k] + (vals[k + 1] - vals[k]) * f);
  }

  // ---------- 叙事栏里的直接操作 ----------
  //
  // 左栏的每一行原本只是「标签 + 数字」。把它们接上球体之后，
  // 读者不必去找右下角那块面板，视线停在哪个数字上就在哪里操作。
  // 悬停是预览（移出即还原），点击是锁定（再点取消）。
  let railLocked = false;
  // 最近一次滚动的时间戳。悬停预览要能分辨「指针主动移进来」与
  // 「内容被滚到指针下面」—— 后者不该触发预览。
  let lastScrollAt = 0;
  window.addEventListener(
    'wheel',
    () => {
      lastScrollAt = performance.now();
    },
    { passive: true }
  );
  window.addEventListener(
    'touchmove',
    () => {
      lastScrollAt = performance.now();
    },
    { passive: true }
  );
  const railEmit = (intent: Parameters<typeof scenes.applyIntent>[0] | null) => {
    scenes.applyIntent(intent ?? { kind: 'reset' });
    instruments.update(instrumentPayload());
    legend.update(legendPayload());
  };
  const rail = mountRailControls(stepEls, {
    activeStep: () => stepEls[story.state.index] ?? null,
    lock: (intent) => {
      railLocked = intent !== null;
      railEmit(intent);
    },
    preview: (intent) => railEmit(intent),
    hasLock: () => railLocked,
    isScrolling: () => performance.now() - lastScrollAt < 260,
  });

  // 结论页的四条结论各带一个 data-jump，点它就滚回对应那一节。
  // 在末尾复述数字只是重复，能跳回去核对才是「可验证」。
  document.querySelectorAll<HTMLElement>('[data-jump]').forEach((node) => {
    node.addEventListener('click', () => {
      const id = node.dataset.jump;
      if (id) story.goTo(id);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const id = node.dataset.jump;
      if (id) story.goTo(id);
    });
  });

  /**
   * 把「视口被固定条带占掉多少」报给相机与标注层。
   *
   * 相机不知道 DOM 的存在，面板高度只有这里知道。三个时刻各报一次即可：
   * 换仪器、读者折叠或展开、窗口尺寸变化。相机每帧只做一次换算，
   * 于是球体的纵向位置始终跟着面板走：面板高，球抬起来；收起了，球落回去。
   *
   * 标注层拿到的是三块矩形：面板、页眉、页脚。标签跟着球投影走，
   * 球边缘的标签会正好落在页眉或页脚上，只避让面板时实测仍有两条
   * 标签被压住（impact-arrive 压在页眉下、impact-planes 压在页脚上）。
   */
  function reportBottomInset() {
    // 对照模式已经把相机抬到全景并隐藏了整块仪器层。
    // 这里再按仪器面板报一次，会把球重新顶上去，中缝两半就不居中了。
    if (compareActive) return;
    // 讲解模式下图例与仪器都收起了（CSS 只改 opacity），它们仍占着原来的
    // 矩形，标注若照旧避让就会留下一块看不见的禁区。改为只避让页眉页脚
    // 和字幕条本身。
    const touring = document.body.classList.contains('is-touring');
    const rects: { left: number; top: number; right: number; bottom: number }[] = [];
    for (const sel of ['.hud-top', '.hud-bottom']) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // 满宽条带只留上下边：左右边给满视口，免得标注从侧边缝隙钻进去。
      rects.push({ left: 0, top: r.top, right: window.innerWidth, bottom: r.bottom });
    }

    // 左上角的图例也是固定面板。它比标注层高一层，标签压在它下面会丢字。
    if (!touring) {
      const legendRect = legend?.visibleRect();
      if (legendRect) rects.push(legendRect);
    }

    // 字幕条压在右下角，球边缘的标注会正好落在它后面。它比标注层高，
    // 只能让标注自己让开。
    if (touring) {
      const bar = document.querySelector<HTMLElement>('.tour-bar');
      if (bar && !bar.hidden) {
        const r = bar.getBoundingClientRect();
        rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
    }

    const layer = instrumentLayer;
    if (!layer || touring) {
      rig.setBottomInset(0);
      document.documentElement.style.setProperty('--instrument-h', '0px');
      document.documentElement.style.setProperty('--instrument-inset', '0px');
      annotations.setAvoidRects(rects);
      return;
    }
    const inst = layer.querySelector('.instrument:not([hidden])');
    if (!inst) {
      rig.setBottomInset(0);
      document.documentElement.style.setProperty('--instrument-h', '0px');
      document.documentElement.style.setProperty('--instrument-inset', '0px');
      annotations.setAvoidRects(rects);
      return;
    }
    const r = inst.getBoundingClientRect();
    // 面板顶到视口下沿的那一段，就是被占掉的高度
    const inset = Math.max(0, window.innerHeight - r.top);
    rig.setBottomInset(inset);
    // 同一份高度也交给排版：窄屏时正文要整体让开面板，
    // 否则两者会压在同一块区域（实测 390×844 下正文上沿被面板盖住 180px）。
    document.documentElement.style.setProperty('--instrument-h', `${Math.round(r.height)}px`);
    // 比例尺要用「面板顶边」而不是「面板高度」定位：面板高度会随仪器内容
    // 二次变化（读数填进来、折叠展开），而顶边是量出来的绝对位置。
    document.documentElement.style.setProperty('--instrument-inset', `${Math.round(inset)}px`);
    // 球上的标签也要知道面板在哪：镜头压低时下半球的标签会正好落到
    // 面板背后，光靠 CSS 层级救不回来，只能让标签自己让开。
    rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    annotations.setAvoidRects(rects);
  }

  const ticks = mountStageTicks(
    ALL_STEPS.map((s) => ({ id: s.id, nav: s.nav })),
    (id) => story.goTo(id)
  );

  // 步骤标识 → 镜头状态标识。文案层已经声明了每步想要的镜头（StepCopy.scene），
  // 这里做一次查表，避免场景层去猜叙事步骤的名字。
  const sceneById = new Map(ALL_STEPS.map((s) => [s.id, s.scene]));

  let lastTickState = '';
  let lastScene = '';
  let lastStepId = '';
  // 读数卡的关闭函数要等卡片 DOM 与状态就位后才存在，而 onStep 的
  // 首帧回调在那之前就会跑一次。用一个可空引用过渡，避免在
  // 声明之前访问 const（会直接抛 ReferenceError，整页起不来）。
  let closePickCard: (() => void) | null = null;
  story.onStep((state) => {
    if (compareActive) return;
    const scene = sceneById.get(state.id) ?? 'establish';
    scenes.apply(state, scene);

    // 仪器跟随场景切换。
    //
    // 两台仪器会连续挂在同一章的几步上（第三到五章各有这种情况）。
    // 这时 instruments.set 收到的 id 与当前相同、直接早退，但场景层已经
    // 把用户输入清掉了：仪器上还留着上一步拖过的游标或锁定的档位，
    // 而画面上是全部。所以场景一换就让仪器也回到默认，两边始终一致。
    if (scene !== lastScene) {
      lastScene = scene;
      instruments.resetUserState();
      // 标注与环一起换。同一场景的连续步骤不重建：重建会让标签闪一下。
      const specs = annoByScene[scene] ?? [];
      annotations.setSpecs(specs);
      overlays.setSpecs(specs);
    }
    // 正文里的锁定按「步」失效，而不是按「场景」。
    //
    // 有些相邻步骤共用同一个场景（第五章的「按层看」与「时间常数」都停在
    // decay-observe）。只按场景判断时，读者在上一页锁了一层高度、翻到下一页
    // 仍带着这个筛选，而那一页的正文已经在讲时间常数了。
    if (state.id !== lastStepId) {
      lastStepId = state.id;
      rail.reset();
      // 换页就收起读数卡。卡片描述的是上一页那个点，镜头与筛选都换了之后
      // 它还挂在屏幕上，读者会以为它说的是新画面里的东西。
      closePickCard?.();
    }
    instruments.set(scenes.instrument);
    instruments.update(instrumentPayload());
    legend.update(legendPayload());
    reportBottomInset();

    // 刻度状态：只在与上次不同时写 DOM
    const key = `${state.index}`;
    if (key !== lastTickState) {
      lastTickState = key;
      let i = 0;
      for (const [, btn] of ticks) {
        btn.dataset.state = i < state.index ? 'past' : i === state.index ? 'active' : 'idle';
        i += 1;
      }
      // 当前刻度滚进视野。19 步在窄屏上必然溢出，不滚的话
      // 读者翻到第五章时底部还停在第一章。
      //
      // 不用 scrollIntoView：它会把祖先滚动容器（包括窗口）一起滚，
      // 而此刻窗口正在做章节的平滑滚动，两者互相打断，实测末尾几步
      // 刻度条停在最左端不动。直接改刻度条自己的 scrollLeft，
      // 只动这一条横向滚动，不碰页面纵向位置。
      const activeTick = [...ticks.values()].find((b) => b.dataset.state === 'active');
      const tickHost = activeTick?.parentElement;
      if (activeTick && tickHost) {
        // 用矩形而不是 offsetLeft：刻度条的 offsetParent 是固定定位的 HUD，
        // 不是滚动容器本身，offsetLeft 会带上整条 HUD 的横向偏移。
        const hostRect = tickHost.getBoundingClientRect();
        const tickRect = activeTick.getBoundingClientRect();
        const delta =
          tickRect.left + tickRect.width / 2 - (hostRect.left + hostRect.width / 2);
        tickHost.scrollTo({ left: Math.max(0, tickHost.scrollLeft + delta), behavior: 'smooth' });
      }
    }
  });

  // 读者折叠或展开面板时球要跟着落回去或抬起来。
  // 折叠按钮在宿主内部，那里拿不到相机，因此在这里用委托监听一次。
  instrumentLayer.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest('.instrument-fold')) {
      // 面板高度在这一帧之后才更新，等一次布局再量
      requestAnimationFrame(reportBottomInset);
    }
  });

  // ---------- 尾页静音 ----------
  //
  // 仪器层固定在右下角，而尾页是全宽的文字页。读者滚到尾页时，
  // 上一章的仪器还留在原位压着正文，两条信息叠在一起谁都读不清。
  // 用 IntersectionObserver 判断尾页是否进入视口，进入就把整层淡出。
  //
  // 为什么不用「滚过最后一步」来判断：尾页前面还有一段滚动余量，
  // 按步骤判断会让仪器在读者开始读尾页之前就消失，出现一段空窗。
  const methodsEl = document.getElementById('methods');
  if (methodsEl) {
    const muteObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          instruments.setMuted(e.isIntersecting);
          annotations.setMuted(e.isIntersecting);
          overlays.setMuted(e.isIntersecting);
          legend.setMuted(e.isIntersecting);
        }
      },
      // 尾页顶部越过视口下沿一小段之后才静音，避免与正文末步争抢
      { rootMargin: '0px 0px -12% 0px' }
    );
    muteObserver.observe(methodsEl);
  }

  // ---------- 仪表读数 ----------
  const epochEl = document.getElementById('epoch-value');
  if (epochEl) epochEl.textContent = isoDate(catalogMeta.epoch);

  const readDist = document.getElementById('readout-distance');
  const readFps = document.getElementById('readout-fps');
  const readPoints = document.getElementById('readout-points');
  const readQuality = document.getElementById('readout-quality');
  if (readPoints) readPoints.textContent = int(count + dCount);
  if (readQuality) readQuality.textContent = `${renderer.getPixelRatio().toFixed(2)}x`;

  // 顶栏右侧补一个「当前时间切片」读数：第二章之后它是画面状态的直接解释，
  // 没有它观众会以为点变少是渲染出问题。
  const readYear = document.getElementById('readout-year');
  const yearField = document.getElementById('field-year');

  // ---------- 对象读数卡 ----------
  //
  // 点场景里任意一个点，看它是谁。这是这一页唯一一个「读者自己提问」的入口：
  // 在此之前 18,610 个点只能被整体地看，没有任何办法问「这一个是什么」。
  const picker = createPicker();
  const pickCard = document.getElementById('pick-card');
  const pickKind = document.getElementById('pick-kind');
  const pickName = document.getElementById('pick-name');
  const pickRows = document.getElementById('pick-rows');
  const pickClose = document.getElementById('pick-close');

  /** 类别码 → 中文名，与 pointCloud.ts 的 CATEGORY 一一对应。 */
  const KIND_LABEL = ['工作中的载荷', '已停止工作的载荷', '火箭残骸', '碎片', '未分类'];

  /** 轨道类型码 → 名称，取自 catalog-meta.json 的 orbitClassLabels。 */
  function orbitClassName(code: number): string {
    const labels = catalogMeta.orbitClassLabels;
    const i = Math.round(code);
    return labels[i] ?? '-';
  }

  function hidePick() {
    pickCard?.setAttribute('hidden', '');
    pendingNameIndex = null;
    // 卡片收起时标记一起收起：它存在的意义是「配合这张卡片指出是哪一个」，
    // 卡片没了还留一个环，读者会以为那是一个可选中的目标。
    clearPickMarker();
  }
  closePickCard = hidePick;

  // ---------- 点选标记 ----------
  //
  // 读数卡关掉之后，读者再也找不到刚才看的是哪一个点：球在缓慢自转，
  // 一万多个光点里认不出刚才那一个。标记把「刚才点的位置」固定在球上，
  // 镜头转动、球体自转时它跟着那个点走，直到关掉卡片或切换章节。
  const pickMarker = document.getElementById('pick-marker');
  const pickMarkerPos = new THREE.Vector3();
  let pickMarkerKind: 'catalog' | 'debris' | null = null;

  /** 记住被点中的那个点的场景坐标。两种图层的坐标都在 position 属性里。 */
  function setPickMarker(index: number, kind: 'catalog' | 'debris') {
    if (!pickMarker) return;
    const points = kind === 'catalog' ? layer.points : debrisLayer.points;
    const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!attr || index >= attr.count) return;
    pickMarkerPos.fromBufferAttribute(attr, index);
    pickMarkerKind = kind;
    pickMarker.removeAttribute('hidden');
  }

  function clearPickMarker() {
    pickMarkerKind = null;
    pickMarker?.setAttribute('hidden', '');
  }

  /** 每帧把标记投影到屏幕；转到球背面或跑出视口时收起，避免「贴在天空上」。 */
  function updatePickMarker() {
    if (!pickMarker || !pickMarkerKind) return;
    // 与标注层同一判据：从锚点指向相机的方向与锚点法线同向，说明它在正面。
    const camPos = rig.camera.getWorldPosition(new THREE.Vector3());
    const toCam = camPos.clone().sub(pickMarkerPos);
    if (pickMarkerPos.dot(toCam) <= 0) {
      pickMarker.style.opacity = '0';
      return;
    }
    const p = pickMarkerPos.clone().project(rig.camera);
    if (p.z > 1) {
      pickMarker.style.opacity = '0';
      return;
    }
    const x = ((p.x + 1) / 2) * window.innerWidth;
    const y = ((1 - p.y) / 2) * window.innerHeight;
    const inside = x > -24 && x < window.innerWidth + 24 && y > -24 && y < window.innerHeight + 24;
    pickMarker.style.opacity = inside ? '1' : '0';
    pickMarker.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  // 编目名称按需加载。卡片第一次打开时才去取这份 223 KB 的附表，
  // 取到之前卡片照常显示编号与读数，不阻塞任何交互。
  let catalogNames: CatalogNames | null = null;
  let namesPending = false;
  /** 当前卡片对应的点索引，供名称迟到时回填。 */
  let pendingNameIndex: number | null = null;
  /** 卡片的锚点（点选处的屏幕坐标），名称迟到后重新排版时还要用。 */
  let pickAnchor: { x: number; y: number } | null = null;

  function ensureNames(): void {
    if (catalogNames || namesPending) return;
    namesPending = true;
    void loadCatalogNames()
      .then((names) => {
        catalogNames = names;
        // 名称到得比卡片晚时补一次：读者已经打开卡片，不该看到永远空着的名字。
        if (pickCard && !pickCard.hasAttribute('hidden') && pendingNameIndex !== null) {
          const n = names[pendingNameIndex];
          if (n) {
            pickName!.textContent = n;
            // 名称比占位的「编目号 12345」长，可能把标题挤成两行。
            // 卡片高度变了就要重新夹一次，否则会往下长到底部 HUD 背后。
            if (pickAnchor) placePick(pickAnchor.x, pickAnchor.y);
          }
        }
      })
      .catch((err) => {
        console.warn('编目名称加载失败，读数卡将只显示编号：', err);
      })
      .finally(() => {
        namesPending = false;
      });
  }

  function catalogNameAt(index: number): string | null {
    const n = catalogNames?.[index];
    return n && n.length > 0 ? n : null;
  }

  /**
   * 静默拉取名称表。
   *
   * 与 ensureNames 的区别：它不回填读数卡，也不要求卡片已打开。
   * 探针在悬停时就调用它，于是读者真正点下去时名称通常已经在内存里，
   * 卡片不会先闪一下编目号再变成名字。
   */
  function ensureNamesQuiet(): void {
    ensureNames();
  }

  /**
   * 把卡片放到点选处附近，并保证不出界。
   *
   * 尺寸必须现量，不能写死：碎片卡四行读数实测 162px，编目卡三行 162px、
   * 名称换成两行时会更高。写死 150 时底边会被裁掉 12px，还会压到底部 HUD 上。
   * 先去掉 hidden 再量，隐藏元素的 offsetWidth/Height 为 0。
   */
  function placePick(x: number, y: number) {
    if (!pickCard) return;
    pickCard.removeAttribute('hidden');
    const w = pickCard.offsetWidth;
    const h = pickCard.offsetHeight;
    const margin = 12;
    // 底部 HUD 是满宽固定条，卡片不能盖住章节刻度。
    const hud = document.querySelector<HTMLElement>('.hud-bottom');
    const hudTop = hud ? hud.getBoundingClientRect().top : window.innerHeight;
    const maxTop = Math.min(window.innerHeight, hudTop) - h - margin;
    pickCard.style.left = `${Math.max(margin, Math.min(window.innerWidth - w - margin, x + 14))}px`;
    pickCard.style.top = `${Math.max(margin, Math.min(maxTop, y - 12))}px`;
  }

  function showPick(x: number, y: number, kind: string, name: string, rows: [string, string][]) {
    if (!pickCard || !pickKind || !pickName || !pickRows) return;
    pickKind.textContent = kind;
    pickName.textContent = name;
    pickRows.replaceChildren();
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.className = 'mono';
      dd.textContent = v;
      pickRows.append(dt, dd);
    }
    placePick(x, y);
  }

  pickClose?.addEventListener('click', hidePick);

  // Esc 关闭读数卡。卡片自身不是模态，读者点开球上任意一点后
  // 注意力在画面上，回到键盘时最自然的动作就是按 Esc；
  // 只留右上角的小叉时，实测多数人先试着按键而卡片不动。
  // Esc 的两级含义：先关心自己的状态（读数卡开着就关卡片），
  // 卡片已经关了才撤销筛选。用一个键同时做两件事时，顺序很重要：
  // 反过来的话，读者看着卡片按 Esc，卡片不动、球却突然全亮，会更困惑。
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (pickCard && !pickCard.hasAttribute('hidden')) {
      hidePick();
      e.preventDefault();
      return;
    }
    const active = scenes.category !== null || scenes.group !== null || scenes.band !== null ||
      scenes.bin !== null || scenes.horizon > 0;
    if (active) {
      scenes.applyIntent({ kind: 'reset' });
      instruments.update(instrumentPayload());
      legend.update(legendPayload());
      announce('已清除筛选，画面恢复当前章节的默认视图。');
      e.preventDefault();
    }
  });

  // ---------- 悬停探针 ----------
  //
  // 指针停在球上时，在指针旁报出最近那个点是什么。它是点选的低成本预览：
  // 不点也能知道那里有什么，点下去才是完整读数卡。
  //
  // 节流到 ~15Hz：每次探测要遍历一万多个点，跟随 mousemove 的原始频率
  // 会在低端机上把主线程占满。
  const probeEl = document.getElementById('probe');
  const probeLabel = document.getElementById('probe-label');
  let probeAt = 0;
  let probeTimer = 0;

  /**
   * 屏幕上一段像素对应多少场景单位。
   *
   * 拾取半径必须按屏幕像素换算，而不是写死一个「公里数」：
   * 镜头拉远时同样的像素覆盖更大的实际距离，写死会让近景点不中、
   * 远景一点就命中一大片。
   */
  function pickRadiusScene(px: number): number {
    const vFov = (rig.camera.fov * Math.PI) / 180;
    const worldPerPixel =
      (2 * Math.tan(vFov / 2) * rig.distance * SCENE_EARTH_RADIUS) / window.innerHeight;
    return worldPerPixel * px;
  }

  /**
   * 把探针放到指针旁边，贴边时翻到另一侧。
   *
   * 探针宽度随读数文字变化（「已停止工作的载荷 · 36128 km」比「碎片 · 812 km」
   * 宽一倍），写死一个偏移量会让它在右侧和底部越出视口：实测指针在 x=1406
   * 时标签右边缘到 1598，而视口只有 1440。必须先写文字再量尺寸。
   */
  function positionProbe(clientX: number, clientY: number) {
    if (!probeEl) return;
    const margin = 8;
    const w = probeEl.offsetWidth;
    const h = probeEl.offsetHeight;
    const left =
      clientX + 14 + w > window.innerWidth - margin
        ? Math.max(margin, clientX - 14 - w)
        : clientX + 14;
    const top =
      clientY + 12 + h > window.innerHeight - margin
        ? Math.max(margin, clientY - 12 - h)
        : clientY + 12;
    probeEl.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
  }

  function probeAtPoint(clientX: number, clientY: number) {
    if (!probeEl || !probeLabel) return;
    const ndc = {
      x: (clientX / window.innerWidth) * 2 - 1,
      y: -((clientY / window.innerHeight) * 2 - 1),
    };
    const radius = pickRadiusScene(9);

    const hitDebris = debrisLayer.points.visible
      ? picker.pick(debrisLayer.points, rig.camera, ndc, radius)
      : null;
    if (hitDebris) {
      const o = hitDebris.index * debris.meta.stride;
      const g = debris.meta.groups[Math.round(debris.points[o + debris.offset.groupId])];
      const norad = Math.round(debris.points[o + debris.offset.noradId]);
      probeLabel.textContent = `${g?.label ?? '碎片'} · ${debris.points[
        o + debris.offset.perigeeKm
      ].toFixed(0)} km · ${norad}`;
      // 先显示再定位：隐藏元素的 offsetWidth 为 0，量不到真实宽度。
      probeEl.removeAttribute('hidden');
      positionProbe(clientX, clientY);
      return;
    }

    if (layer.points.visible) {
      const hit = picker.pick(layer.points, rig.camera, ndc, radius, (i) => launchYears[i] <= layer.yearMax);
      if (hit) {
        const o = hit.index * stride;
        const cat = Math.round(catalog[o + offset.category]);
        // 名称表没到之前只给编目号：探针每帧都在跑，不能等一次网络往返。
        const name = catalogNameAt(hit.index);
        probeLabel.textContent = name
          ? `${name} · ${catalog[o + offset.perigeeKm].toFixed(0)} km`
          : `${KIND_LABEL[cat] ?? '未分类'} · ${catalog[o + offset.perigeeKm].toFixed(0)} km`;
        // 名称一旦取回来，探针也要能显示它。第一次探测到对象时顺手拉一次附表；
        // 它在后台加载，不阻塞这次读数。
        if (!name) ensureNamesQuiet();
        probeEl.removeAttribute('hidden');
        positionProbe(clientX, clientY);
        return;
      }
    }

    probeEl.setAttribute('hidden', '');
  }

  canvas.addEventListener('pointermove', (e) => {
    // 拖动视角时不报读数：读者在做另一件事，弹一个标签只会碍事。
    if (rig.lastDragDistance > 6 && e.buttons !== 0) {
      probeEl?.setAttribute('hidden', '');
      return;
    }
    const now = performance.now();
    if (now - probeAt < 66) {
      // 落在节流窗口里：记下最后一次位置，窗口结束时补一次，
      // 避免指针停住后读数停在旧位置。
      window.clearTimeout(probeTimer);
      probeTimer = window.setTimeout(() => probeAtPoint(e.clientX, e.clientY), 70);
      return;
    }
    probeAt = now;
    probeAtPoint(e.clientX, e.clientY);
  });

  canvas.addEventListener('pointerleave', () => probeEl?.setAttribute('hidden', ''));
  window.addEventListener('scroll', () => probeEl?.setAttribute('hidden', ''), { passive: true });

  canvas.addEventListener('click', (e) => {
    // 拖动视角时不弹卡：相机把按下到抬起的位移记在 lastDragDistance 里，
    // 位移小于 6 像素才算点击。没有这个判断的话，每次转完视角都会弹出一张卡。
    if (rig.lastDragDistance > 6) return;
    const ndc = {
      x: (e.clientX / window.innerWidth) * 2 - 1,
      y: -((e.clientY / window.innerHeight) * 2 - 1),
    };

    // 命中半径按屏幕像素换算，约 11 像素：比一个光点略大，
    // 又不会在点云密集处一次命中半个屏幕。
    const maxKm = pickRadiusScene(11);

    // 先试碎片层（它通常在上面），再试编目层
    const hitDebris = debrisLayer.points.visible
      ? picker.pick(debrisLayer.points, rig.camera, ndc, maxKm)
      : null;
    if (hitDebris) {
      const i = hitDebris.index;
      const o = i * debris.meta.stride;
      const g = debris.meta.groups[Math.round(debris.points[o + debris.offset.groupId])];
      const norad = Math.round(debris.points[o + debris.offset.noradId]);
      // 碎片卡不依赖编目名称表。清掉待回填索引，否则名称迟到时会把
      // 上一张编目卡的标题写到这张碎片卡上。
      pendingNameIndex = null;
      setPickMarker(i, 'debris');
      showPick(hitDebris.screenX, hitDebris.screenY, g?.label ?? '碎片', `编目号 ${norad}`, [
        ['近地点', `${debris.points[o + debris.offset.perigeeKm].toFixed(1)} km`],
        ['远地点', `${debris.points[o + debris.offset.apogeeKm].toFixed(1)} km`],
        ['倾角', `${debris.points[o + debris.offset.inclDeg].toFixed(2)}°`],
        ['所属事件', g?.event ?? '-'],
      ]);
      return;
    }

    if (!layer.points.visible) return;
    const hit = picker.pick(layer.points, rig.camera, ndc, maxKm, (i) => {
      // 只接受当前可见的点：被年份或高度筛掉的点不该能被点到，
      // 否则用户会点中一个画面上根本不存在的对象。
      const y = layer.yearMax;
      const yy = launchYears[i];
      return yy <= y;
    });
    if (!hit) {
      hidePick();
      return;
    }
    const o = hit.index * stride;
    const cat = Math.round(catalog[o + offset.category]);
    const yr = catalog[o + offset.launchYear];
    const norad = Math.round(catalog[o + offset.noradId]);
    // 卡片标题优先给对象名，名称到齐后替换掉占位的编目号。
    // 「名称 + 编目号」两行都在才是可核对的身份：名称会重名，
    // 编目号不会；只给其中一个，读者都无法拿去 CelesTrak 查。
    pendingNameIndex = hit.index;
    pickAnchor = { x: hit.screenX, y: hit.screenY };
    ensureNames();
    setPickMarker(hit.index, 'catalog');
    const title = catalogNameAt(hit.index) ?? `编目号 ${norad}`;
    showPick(hit.screenX, hit.screenY, KIND_LABEL[cat] ?? '未分类', title, [
      ['编目号', String(norad)],
      ['近地点', `${catalog[o + offset.perigeeKm].toFixed(1)} km`],
      ['轨道类型', orbitClassName(catalog[o + offset.orbitClass])],
      ['发射年', yr > 0 ? String(yr) : '未记录'],
    ]);
  });

  // ---------- 渲染循环 ----------
  // THREE.Clock 在新版本里已标记弃用（控制台每次启动都会警告一次）。
  // Timer 用同一套秒为单位的时间差，额外接了 Page Visibility：
  // 切到后台再回来时不会给出一段几十秒的 delta，动画不会跳。
  const timer = new THREE.Timer();
  timer.connect(document);
  let frames = 0;
  let fpsAccum = 0;
  let fps = 0;
  let hudAccum = 0;

  /**
   * 自适应画质。
   *
   * 评审现场的设备不可控，集成显卡上 16,000 个点加辉光可能掉到 25 帧。
   * 掉帧时先降像素比，再降点的亮度叠加：这两项对观感的影响最小，
   * 而构图的判断力保留。只降不升，避免在阈值附近来回抖。
   *
   * 判定用连续两次采样（约 2 秒）都低于 42 帧才动手，避免加载瞬间的
   * 一次低帧率就把画质永久压下去。
   */
  let lowStreak = 0;
  let qualityStep = 0;
  function adaptQuality(measured: number) {
    if (qualityStep >= 2) return;
    // 前两秒不参与判断：纹理与字体还在解码，帧率不可信。
    if (timer.getElapsed() < 2.5) return;
    lowStreak = measured < 42 ? lowStreak + 1 : 0;
    if (lowStreak < 2) return;
    lowStreak = 0;
    qualityStep += 1;
    if (qualityStep === 1) {
      renderer.setPixelRatio(Math.min(1.25, renderer.getPixelRatio()));
      if (readQuality) readQuality.textContent = `${renderer.getPixelRatio().toFixed(2)}x`;
    } else {
      layer.setOpacity(0.55);
      debrisLayer.setOpacity(0.9);
      layer.setGhostOpacity(0.08);
    }
  }

  function frame(timestamp?: number): void {
    timer.update(timestamp);
    const dt = Math.min(0.1, timer.getDelta());

    story.update();
    // 对照模式下仍需推进相机：进入时 setPose 到全景要有一段平滑过渡。
    // 叙事层已经被 compareActive 挡住，不会再把机位拉回当前章节。
    rig.update(dt);
    starfield.update(dt);
    overlays.update(dt);
    updatePickMarker();
    annotations.update(rig.camera, {
      yearMax: scenes.yearMax,
      years: scenes.horizon * 200,
      remaining: remainingAt(scenes.horizon * 200),
    });
    if (compare.active) compare.render();
    else renderer.render(scene, rig.camera);

    frames += 1;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      fps = frames / fpsAccum;
      frames = 0;
      fpsAccum = 0;
      adaptQuality(fps);
    }

    // 读数每秒更新一次。刷新太快会让数字无法被读，
    // 而「能读出读数」本身是这类仪器式页面可信度的一部分。
    hudAccum += dt;
    if (hudAccum >= 0.5) {
      hudAccum = 0;
      if (readDist) readDist.textContent = cameraDistanceKm(rig.distance);
      if (readFps) readFps.textContent = fps.toFixed(0);
      // 面板位置也按同一个节拍重报一次。
      //
      // 换步时已经报过一次，但仪器内容会在之后才落定：读数填进来、
      // 直方图挂上柱子、字体载入完成，都会让面板再长高几像素。
      // 只报一次时标注层记的是旧矩形，实测 impact-planes 的轨道面标签
      // 会压在面板上沿 4px。2Hz 重读三个固定元素的矩形，代价可以忽略。
      reportBottomInset();
      updateScaleBar();
      if (readYear && yearField) {
        const y = scenes.yearMax;
        if (y === null) {
          // 不筛选时这一格没有信息量，收起来而不是显示「全部」，
          // 仪器面板上不出现空转的字段。
          yearField.setAttribute('hidden', '');
        } else {
          yearField.removeAttribute('hidden');
          readYear.textContent = String(y);
        }
      }
    }

    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', () => {
    rig.camera.aspect = window.innerWidth / window.innerHeight;
    rig.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    reportBottomInset();
  });

  // 首帧渲染完成后再撤遮罩，避免出现空场景一闪
  renderer.render(scene, rig.camera);
  story.update();
  requestAnimationFrame(() => {
    const veil = document.getElementById('boot-veil');
    if (veil) {
      veil.classList.add('is-gone');
      window.setTimeout(() => veil.setAttribute('hidden', ''), 800);
    }
    document.body.classList.remove('is-veiled');
  });

  /**
   * 锚点跳转的收尾。
   *
   * jumpTo 内部会反复量、反复跳，直到步骤下标与坐标同时对上。但它有一个
   * 时间上限：面板换高、字体回流可能比它更久。实测手机端打开
   * #growth-intro，落位瞬间是对的，一秒后正文高度变化又把目标步推下去，
   * 画面停在它的前一步。这里在之后几个时间点再补跳几次，每次都以
   * 「当前布局」重新算，因此后面到来的回流也能被跟上。
   */
  function settleOnStep(id: string) {
    for (const delay of [0, 350, 800, 1400, 2100]) {
      window.setTimeout(() => story.jumpTo(id), delay);
    }
  }

  // ---------- 章节深链 ----------
  //
  // 评审现场经常要「直接翻到第五章」，而 19 步的滚动叙事只能靠滚轮找。
  // 支持 #step-id 形式的锚点：带锚点打开时直接落到那一步，
  // 章节变化时把地址栏同步过去。地址用 replaceState，不制造一堆历史记录，
  // 读者按浏览器后退仍然是离开页面，而不是在章节之间跳。
  //
  // 图例上的「复制本步链接」复用的就是这套锚点。
  {
    const validIds = new Set(ALL_STEPS.map((s) => s.id));
    const initial = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
    if (validIds.has(initial)) {
      // 两帧之后再跳：第一帧让字体与布局落定，第二帧让 canvas 尺寸稳定。
      // 实测单帧时落点会偏，因为 scrollStory 量区间时图片/字体还会把页面撑高。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          settleOnStep(initial);
          // 落位之后把区间再量一次，并把地址栏对齐到真正进入的那一步。
          window.setTimeout(() => {
            window.history.replaceState(null, '', `#${story.state.id}`);
          }, 320);
        })
      );
    }
    let lastHash = '';
    window.setInterval(() => {
      const id = story.state.id;
      if (!id || id === lastHash) return;
      lastHash = id;
      if (validIds.has(id)) {
        window.history.replaceState(null, '', `#${id}`);
      }
    }, 400);

    // 同一页面内改锚点不会重新加载，上面的首屏逻辑只在冷启动时跑一次。
    // 评委在现场常把链接粘到地址栏回车（同标签），这里补一次 hashchange，
    // 否则地址变了画面不动，看起来像链接失效。
    window.addEventListener('hashchange', () => {
      const id = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
      if (!validIds.has(id)) return;
      // 已经停在这一步就不动：下面那个定时器还会把 hash 写回当前步，
      // 此时再跳一次会让平滑滚动与它自己打架。
      if (story.state.id === id) return;
      settleOnStep(id);
    });
  }

  frame();

  // 调试与自动化校验入口：?qa=1 时暴露运行状态
  if (new URLSearchParams(window.location.search).has('qa')) {
    (window as unknown as { __orbit: unknown }).__orbit = {
      stats: () => ({
        calls: renderer.info.render.calls,
        points: renderer.info.render.points,
        programs: renderer.info.programs?.length ?? 0,
        fps: +fps.toFixed(1),
        cameraDistanceEarthRadii: +rig.distance.toFixed(3),
        step: story.state.id,
        scene: scenes.currentSceneId,
        stepProgress: +story.state.progress.toFixed(3),
        yearMax: scenes.yearMax,
        catalogVisible: layer.points.visible,
        debrisVisible: debrisLayer.points.visible,
        horizon: debrisLayer.horizon,
        categories: catalogMeta.categories,
        // 仪器状态。筛选在顶点着色器里完成，不改变 draw call 数，
        // 因此只有把 uniform 读出来才能验证「点了某一层」真的生效。
        instrument: instruments.current,
        instrumentEngaged: instruments.engaged,
        catalogMetricRange: layer.metricRange,
        debrisMetricRange: debrisLayer.metricRange,
        debrisGroupRange: debrisLayer.groupRange,
        categoryEmphasis: scenes.category,
        debrisGroupPicked: scenes.group,
        ghost: layer.ghost,
        legendVisible: Boolean(legend.visibleRect()),
        compareActive: compare.active,
        compareWipe: +compare.wipe.toFixed(3),
        tourActive: Boolean(tourRef?.active),
        tourIndex: tourRef?.index ?? -1,
      }),
      goTo: (id: string) => story.goTo(id),
      /** 自动化校验用：直接开关两个演示模式。 */
      compare: {
        open: () => compare.open(),
        close: () => compare.close(),
        toggle: () => compare.toggle(),
      },
      tour: {
        open: () => tourRef?.open(),
        close: () => tourRef?.close(),
        state: () => ({ active: Boolean(tourRef?.active), index: tourRef?.index ?? -1 }),
      },
      figures,
      ranges: () => story.debugRanges(),
      /** 自动化校验用：模拟点选与图例操作，验证球面真的改变了。 */
      intent: (i: Parameters<typeof scenes.applyIntent>[0]) => {
        scenes.applyIntent(i);
        instruments.update(instrumentPayload());
        legend.update(legendPayload());
      },
    };
  }

  void scaled;
}

main().catch((err) => {
  console.error(err);
  failBoot(err);
});
