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

import { buildFigures, type DebrisGroupFigures } from './content/figures';
import { CHAPTER_ONE_STEPS, type StepCopy } from './content/chapter1';
import { CHAPTER_TWO_STEPS } from './content/chapter2';
import { CHAPTER_THREE_STEPS } from './content/chapter3';
import { CHAPTER_FOUR_STEPS } from './content/chapter4';
import { CHAPTER_FIVE_STEPS } from './content/chapter5';
import { renderMethods, methodSpecs } from './content/methods';
import { createChapterScenes, DEBRIS_PALETTE } from './chapters/scenes';

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
  for (let i = 0; i < count; i += 1) {
    const o = i * stride;
    categories[i] = catalog[o + offset.category];
    positions[i * 3] = catalog[o + offset.x];
    positions[i * 3 + 1] = catalog[o + offset.y];
    positions[i * 3 + 2] = catalog[o + offset.z];
    // 年份用于第二章的「按时间逐步出现」。没有年份的对象给一个极大的
    // 负数，任何时间切片都会把它们包含进来——它们确实无法定年，
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
  // 表示在这 200 年里不会消失——这正是页面上要表达的那件事。
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

  const ticks = mountStageTicks(
    ALL_STEPS.map((s) => ({ id: s.id, nav: s.nav })),
    (id) => story.goTo(id)
  );

  // 步骤标识 → 镜头状态标识。文案层已经声明了每步想要的镜头（StepCopy.scene），
  // 这里做一次查表，避免场景层去猜叙事步骤的名字。
  const sceneById = new Map(ALL_STEPS.map((s) => [s.id, s.scene]));

  let lastTickState = '';
  story.onStep((state) => {
    scenes.apply(state, sceneById.get(state.id) ?? 'establish');

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
          // 不筛选时这一格没有信息量，收起来而不是显示「全部」——
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
