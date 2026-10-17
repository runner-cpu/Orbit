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
import { loadSceneData, loadDebrisData, loadHistoryData } from './core/data';
import { cameraDistanceKm, int, isoDate, scaled } from './core/format';
import { createInstrumentHost, type Instrument, type InstrumentId } from './core/instrument';
import { createPicker } from './core/picking';
import { mountRailControls } from './core/railControl';

import { buildFigures, type DebrisGroupFigures } from './content/figures';
import { CHAPTER_ONE_STEPS, type StepCopy } from './content/chapter1';
import { CHAPTER_TWO_STEPS } from './content/chapter2';
import { CHAPTER_THREE_STEPS } from './content/chapter3';
import { CHAPTER_FOUR_STEPS } from './content/chapter4';
import { CHAPTER_FIVE_STEPS } from './content/chapter5';
import { renderMethods, methodSpecs } from './content/methods';
import { createChapterScenes, DEBRIS_PALETTE } from './chapters/scenes';
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

  // ---------- 尾页 ----------
  const methodsHost = document.getElementById('methods');
  if (methodsHost) {
    // 运行时数据量按本次实际下载的字节数统计，而不是写死的常量：
    // 编目会更新，写死的体积迟早与实际不符。
    // 海岸线是异步加载且允许失败，这里等它落定再统计，否则会漏算。
    await coastlineReady;
    const dataSizeKb = (data.bytes + debris.bytes + history.bytes + coastlineBytes) / 1024;
    methodsHost.innerHTML = renderMethods(figures, methodSpecs(figures, dataSizeKb));
  }

  // ---------- 滚动叙事 ----------
  const story = createScrollStory(storySteps);
  const scenes = createChapterScenes(rig, layer, debrisLayer, globe, history);

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
    }
  );

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

  /**
   * 把「视口底部被面板占掉多少」报给相机。
   *
   * 相机不知道 DOM 的存在，面板高度只有这里知道。三个时刻各报一次即可：
   * 换仪器、读者折叠或展开、窗口尺寸变化。相机每帧只做一次换算，
   * 于是球体的纵向位置始终跟着面板走：面板高，球抬起来；收起了，球落回去。
   */
  function reportBottomInset() {
    const layer = instrumentLayer;
    if (!layer) return;
    const inst = layer.querySelector('.instrument:not([hidden])');
    if (!inst) {
      rig.setBottomInset(0);
      return;
    }
    const r = inst.getBoundingClientRect();
    // 面板顶到视口下沿的那一段，就是被占掉的高度
    rig.setBottomInset(Math.max(0, window.innerHeight - r.top));
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
  story.onStep((state) => {
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
    }
    // 正文里的锁定按「步」失效，而不是按「场景」。
    //
    // 有些相邻步骤共用同一个场景（第五章的「按层看」与「时间常数」都停在
    // decay-observe）。只按场景判断时，读者在上一页锁了一层高度、翻到下一页
    // 仍带着这个筛选，而那一页的正文已经在讲时间常数了。
    if (state.id !== lastStepId) {
      lastStepId = state.id;
      rail.reset();
    }
    instruments.set(scenes.instrument);
    instruments.update(instrumentPayload());
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
        for (const e of entries) instruments.setMuted(e.isIntersecting);
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
    // 卡片贴着点击位置，但不出界
    const w = 220;
    const h = 150;
    pickCard.style.left = `${Math.min(window.innerWidth - w - 16, Math.max(16, x + 14))}px`;
    pickCard.style.top = `${Math.min(window.innerHeight - h - 16, Math.max(16, y - 12))}px`;
    pickCard.removeAttribute('hidden');
  }

  pickClose?.addEventListener('click', hidePick);

  canvas.addEventListener('click', (e) => {
    // 拖动视角时不弹卡：相机把按下到抬起的位移记在 lastDragDistance 里，
    // 位移小于 6 像素才算点击。没有这个判断的话，每次转完视角都会弹出一张卡。
    if (rig.lastDragDistance > 6) return;
    const ndc = {
      x: (e.clientX / window.innerWidth) * 2 - 1,
      y: -((e.clientY / window.innerHeight) * 2 - 1),
    };

    // 命中半径按当前视距换算：拉得越远，一个点覆盖的实际距离越大，
    // 否则远视角下根本点不中。
    const maxKm = rig.distance * 26;

    // 先试碎片层（它通常在上面），再试编目层
    const hitDebris = debrisLayer.points.visible
      ? picker.pick(debrisLayer.points, rig.camera, ndc, maxKm)
      : null;
    if (hitDebris) {
      const i = hitDebris.index;
      const o = i * debris.meta.stride;
      const g = debris.meta.groups[Math.round(debris.points[o + debris.offset.groupId])];
      showPick(hitDebris.screenX, hitDebris.screenY, g?.label ?? '碎片', `编号 ${i + 1}`, [
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
    showPick(hit.screenX, hit.screenY, KIND_LABEL[cat] ?? '未分类', `编号 ${hit.index + 1}`, [
      ['近地点', `${catalog[o + offset.perigeeKm].toFixed(1)} km`],
      ['轨道类型', orbitClassName(catalog[o + offset.orbitClass])],
      ['发射年', yr > 0 ? String(yr) : '未记录'],
    ]);
  });

  // ---------- 渲染循环 ----------
  const clock = new THREE.Clock();
  let frames = 0;
  let fpsAccum = 0;
  let fps = 0;
  let hudAccum = 0;

  function frame(): void {
    const dt = Math.min(0.1, clock.getDelta());

    story.update();
    rig.update(dt);
    renderer.render(scene, rig.camera);

    frames += 1;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      fps = frames / fpsAccum;
      frames = 0;
      fpsAccum = 0;
    }

    // 读数每秒更新一次。刷新太快会让数字无法被读，
    // 而「能读出读数」本身是这类仪器式页面可信度的一部分。
    hudAccum += dt;
    if (hudAccum >= 0.5) {
      hudAccum = 0;
      if (readDist) readDist.textContent = cameraDistanceKm(rig.distance);
      if (readFps) readFps.textContent = fps.toFixed(0);
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
      }),
      goTo: (id: string) => story.goTo(id),
      figures,
    };
  }

  void scaled;
}

main().catch((err) => {
  console.error(err);
  failBoot(err);
});
