/**
 * 《轨道之上》应用入口。
 *
 * 装配顺序：
 *   1. 建三维场景（地球、点云、相机）
 *   2. 载入离线数据
 *   3. 用数据生成文案 DOM（文案里的数字全部来自数据，不写死）
 *   4. 订阅滚动叙事，把步骤状态转成场景参数
 *   5. 起渲染循环，并驱动仪表读数
 *
 * 目前接入的是第一章与尾页「数据与方法」。第二至五章的驱动模块
 * 按同样接口（chapters/ 下一个模块 + content/ 下一个文案模块）接入，
 * 主循环与引擎层不需要改动。
 */
import * as THREE from 'three';
import './style.css';

import { createGlobe, SCENE_EARTH_RADIUS } from './core/globe';
import { PointLayer } from './core/pointCloud';
import { createCameraRig } from './core/camera';
import { createScrollStory, type StoryStep } from './core/scrollStory';
import { loadSceneData, type DebrisMeta } from './core/data';
import { cameraDistanceKm, int, isoDate } from './core/format';

import { buildFigures, type DebrisGroupFigures } from './content/figures';
import { CHAPTER_ONE_STEPS } from './content/chapter1';
import { renderMethods, methodSpecs } from './content/methods';
import { createChapterOneScene } from './chapters/ch1-now';

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

/** 底部章节刻度 */
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
  const data = await loadSceneData();

  setBootStatus('正在解析海岸线');
  void globe.loadCoastlines('data/coastlines.json').catch((err) => {
    // 海岸线只影响地理参照，缺失不应阻断作品
    console.warn('海岸线加载失败，地理参照层将保持空白：', err);
  });

  const debrisMetaRes = await fetch('data/debris-meta.json');
  if (!debrisMetaRes.ok) throw new Error(`debris-meta.json 加载失败：HTTP ${debrisMetaRes.status}`);
  const debrisMeta = (await debrisMetaRes.json()) as DebrisMeta;

  setBootStatus('正在铺开点云');

  // ---------- 点云 ----------
  const { catalog, catalogMeta, offset } = data;
  const stride = catalogMeta.stride;
  const count = catalogMeta.count;

  // 类别数组直接从数据包取出，着色在着色器里完成
  const categories = new Float32Array(count);
  const sizes = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const o = i * stride;
    categories[i] = catalog[o + offset.category];
    positions[i * 3] = catalog[o + offset.x];
    positions[i * 3 + 1] = catalog[o + offset.y];
    positions[i * 3 + 2] = catalog[o + offset.z];
    // 尺寸按对象类别微调：碎片与残骸略小，载荷略大，
    // 让「哪一类是主体」在密度高的区域也能分辨
    const cat = catalog[o + offset.category];
    sizes[i] = cat === 3 ? 0.82 : cat === 2 ? 0.9 : 1;
  }

  const layer = new PointLayer({
    count,
    categories,
    sizes,
    // 点保持小而离散：16,000 个点若各自画大，叠加后会糊成一团。
    // 目标观感是「能数得清的光点」，而不是一片发光的云。
    baseSizePx: 1.35,
    maxSizePx: 4.5,
    referenceDistance: SCENE_EARTH_RADIUS * 4.2,
    opacity: 0.7,
  });
  layer.updateFromEcef(positions);
  scene.add(layer.points);

  // ---------- 文案与统计 ----------
  const debrisFigures: DebrisGroupFigures[] = debrisMeta.groups.map((g) => ({
    key: g.key,
    label: g.label,
    event: g.event,
    color: g.color,
    count: g.count,
    perigeeMedianKm: g.perigeeMedianKm,
    perigeeMinKm: g.perigeeMinKm,
    perigeeMaxKm: g.perigeeMaxKm,
    above800km: g.above800km,
  }));

  const figures = buildFigures(data, debrisFigures);

  const stepEls = mountSteps(
    CHAPTER_ONE_STEPS.map((s) => ({ id: s.id, html: s.render(figures) }))
  );
  const storySteps: StoryStep[] = CHAPTER_ONE_STEPS.map((s, i) => ({
    el: stepEls[i],
    id: s.id,
    pinRatio: s.pinRatio,
  }));

  // ---------- 尾页 ----------
  const methodsHost = document.getElementById('methods');
  if (methodsHost) {
    // 运行时数据量按实际传输的文件体积估算，用于说明离线包大小
    const dataSizeKb = 739;
    methodsHost.innerHTML = renderMethods(figures, methodSpecs(figures, dataSizeKb));
  }

  // ---------- 滚动叙事 ----------
  const story = createScrollStory(storySteps);
  const ch1Scene = createChapterOneScene(rig, layer, globe);

  const ticks = mountStageTicks(
    CHAPTER_ONE_STEPS.map((s) => ({ id: s.id, nav: s.nav })),
    (id) => story.goTo(id)
  );

  // 步骤标识 → 镜头状态标识。文案层已经声明了每步想要的镜头（StepCopy.scene），
  // 这里做一次查表，避免场景层去猜叙事步骤的名字。
  const sceneById = new Map(CHAPTER_ONE_STEPS.map((s) => [s.id, s.scene]));

  let lastTickState = '';
  story.onStep((state) => {
    ch1Scene.apply(state, sceneById.get(state.id) ?? 'establish');

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
  const pointsText = `${int(count)} 万`.replace(`${int(count)}`, int(count));
  if (readPoints) readPoints.textContent = int(count);
  if (readQuality) readQuality.textContent = `${renderer.getPixelRatio().toFixed(2)}x`;

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
        scene: ch1Scene.currentSceneId,
        stepProgress: +story.state.progress.toFixed(3),
        categories: catalogMeta.categories,
      }),
      goTo: (id: string) => story.goTo(id),
      figures,
    };
  }

  void pointsText;
}

main().catch((err) => {
  console.error(err);
  failBoot(err);
});
