import * as THREE from 'three';
import { SCENE_EARTH_RADIUS } from './globe';

/**
 * 相机机位。
 *
 * 用球坐标描述：方位角（绕极轴）、仰角、视距。这样章节之间的镜头变化
 * 都可以表达成这几个标量的插值，不需要处理位置向量的万向节问题。
 * 视距以地球半径为单位，便于内容层用「几倍地球半径」的方式描述取景。
 */
export interface CameraPose {
  /** 方位角（弧度）。0 = 正对本初子午线方向 */
  azimuth: number;
  /** 仰角（弧度）。0 = 赤道面高度，PI/2 = 正上方俯视 */
  elevation: number;
  /** 视距，单位：地球半径 */
  distance: number;
  /**
   * 画面横向偏移，单位：视口半宽的比例。
   * 正值把地球推向画面右侧，为左侧的文字栏让出净空。
   * 这是相机取景，不动地球本身的位置，因此不会影响任何数据。
   */
  screenShift?: number;
}

/** 交互式相机：滚动驱动 + 手动拖拽，两者可随时接管。 */
export interface CameraRig {
  camera: THREE.PerspectiveCamera;
  /** 由滚动叙事写入：目标机位 */
  setPose(pose: CameraPose): void;
  /** 写入自动旋转量（弧度/秒），0 = 停止 */
  setSpin(radPerSec: number): void;
  /** 每帧调用 */
  update(dt: number): void;
  /** 当前实际视距（地球半径倍数），供读数使用 */
  get distance(): number;
  /** 用户是否正在手动操作 */
  get isUserDriving(): boolean;
  /**
   * 上一次按下到抬起之间指针移动的总距离（像素）。
   *
   * 为什么要暴露这个数：画布上同时有两种点击语义，「拖一下转视角」与
   * 「点一个点看它是谁」。两者的区分只能靠位移：位移小到阈值以内才算点击。
   * 这个判断必须由相机提供，因为只有它在跟踪位移。
   */
  get lastDragDistance(): number;
  /** 把当前机位写回目标，用于用户操作后避免镜头跳回 */
  commitUserPose(): void;
  /** 重置手动偏移 */
  releaseUserControl(): void;
  /**
   * 告诉相机：视口底部有这么多像素被面板占掉了，球体不要压在上面。
   *
   * 为什么由外部告知而不是相机自己测：占用高度只有 DOM 知道，
   * 而相机是纯数学层。面板收起、换仪器、窗口缩放都会改变这个数，
   * 调用方在这些时刻各报一次即可，相机每帧只做一次换算。
   */
  setBottomInset(px: number): void;
}

export function createCameraRig(
  canvas: HTMLCanvasElement,
  aspect: number
): CameraRig {
  const camera = new THREE.PerspectiveCamera(38, aspect, 0.005, 4000);

  // 目标机位与当前机位分离：滚动只改目标值，渲染用当前值追赶。
  // 这样章节切换是平滑的，不会因为滚动速度突变而跳动。
  const target: Required<CameraPose> = { azimuth: 0.6, elevation: 0.32, distance: 4.2, screenShift: 0 };
  const current: Required<CameraPose> = { azimuth: 0.6, elevation: 0.32, distance: 4.2, screenShift: 0 };
  /** 由底部净空推出的抬升量，单独缓动，保证收起面板时球是滑回去的 */
  let lift = 0;

  let spin = 0;
  let spinAccum = 0;
  /**
   * 平滑后的旋转速率。
   *
   * 直接用 spin 会在按下瞬间把画面「钉住」，抬起瞬间又突然开始转，
   * 两次都是速度阶跃。这里让实际速率以较高时间常数追上目标值，
   * 停与启都只有几十毫秒，读者感觉不到，但画面不会顿一下。
   */
  let spinRate = 0;

  /**
   * 视口底部被面板占掉的高度（像素）。
   *
   * 球体的纵向构图由它决定：净空越大，球心越往上抬。这样不论当前
   * 挂的是哪一台仪器、面板有多高、读者有没有把它收起来，球体都尽量
   * 避开面板，而不是被压掉一截。面板收起后净空变小，球自己落回来。
   */
  let bottomInsetPx = 0;

  /**
   * 由底部净空换算球体的抬升量（单位：视口半高）。
   *
   * 不做成「把球完整抬到面板之上」：视距最近的那几个场景里球本身就比
   * 视口高，硬抬会把球顶出画面。这里用一条有上限的曲线，抬到一定程度
   * 就停，宁可让面板压住球的下缘一小块，也不破坏构图。
   */
  function liftFromInset(): number {
    const H = window.innerHeight;
    if (H <= 0) return 0;
    // 扣掉底部仪表条与安全间距：面板低于这个高度时不需要抬。
    const free = bottomInsetPx - 140;
    if (free <= 0) return 0;
    return Math.min(0.16, (free / H) * 0.34);
  }

  // 用户手动操作的增量，叠加在滚动驱动的机位之上
  const userOffset = { azimuth: 0, elevation: 0, zoom: 1 };
  const userTarget = { azimuth: 0, elevation: 0, zoom: 1 };
  let userActive = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragDistance = 0;
  let settleTimer = 0;

  const minDistance = SCENE_EARTH_RADIUS * 1.22;
  const maxDistance = SCENE_EARTH_RADIUS * 120;

  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    userActive = true;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-grabbing');
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    // 累加位移，供上层区分「拖拽」与「点击」
    dragDistance += Math.abs(dx) + Math.abs(dy);
    userTarget.azimuth -= dx * 0.005;
    userTarget.elevation = Math.max(
      -1.45,
      Math.min(1.45, userTarget.elevation + dy * 0.004)
    );
    settleTimer = 0;
  };

  const endDrag = (e: PointerEvent) => {
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // 指针可能已被系统释放
    }
    canvas.classList.remove('is-grabbing');
  };

  const onWheel = (e: WheelEvent) => {
    // 只拦截落在画布上的滚轮：页面本身仍然要能滚动。
    // 需要缩放时按住 Shift 或 Ctrl，避免与滚动叙事冲突。
    if (!e.shiftKey && !e.ctrlKey) return;
    e.preventDefault();
    userActive = true;
    const factor = 1 + Math.sign(e.deltaY) * 0.09;
    userTarget.zoom = Math.max(0.28, Math.min(6, userTarget.zoom * factor));
    settleTimer = 0;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', () => {
    // 双击归位：回到滚动叙事给定的机位
    userTarget.azimuth = 0;
    userTarget.elevation = 0;
    userTarget.zoom = 1;
    settleTimer = 0;
  });

  // 画布要能拿到焦点，键盘操作才有落点。tabIndex 在这里设而不是写在
  // HTML 上：canvas 默认不可聚焦，忘了设的话下面这段键盘处理永远不触发。
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    '三维轨道场景。方向键旋转视角，加减号缩放，0 键复位；用 Tab 切到右侧仪器可筛选对象。'
  );

  /**
   * 键盘操作。
   *
   * 拖拽与滚轮是鼠标手势，键盘与辅助技术用户没有任何入口能改动视角，
   * 而「这个球可以转」本身是作品的主要交互之一。方向键一次转 7°、
   * Shift 加速到 22°；+ / − 缩放；0 或 Home 归位。
   * 键盘接手时同样置 userActive，于是松手 2.5 秒后镜头会缓缓回到叙事机位，
   * 不会把视角永远留在读者随手转到的位置。
   */
  canvas.addEventListener('keydown', (e) => {
    const key = e.key;
    const big = e.shiftKey;
    const azStep = big ? 0.38 : 0.12;
    const elStep = big ? 0.3 : 0.1;
    let handled = true;
    switch (key) {
      case 'ArrowLeft':
        userTarget.azimuth += azStep;
        break;
      case 'ArrowRight':
        userTarget.azimuth -= azStep;
        break;
      case 'ArrowUp':
        userTarget.elevation = Math.max(-1.45, Math.min(1.45, userTarget.elevation + elStep));
        break;
      case 'ArrowDown':
        userTarget.elevation = Math.max(-1.45, Math.min(1.45, userTarget.elevation - elStep));
        break;
      case '+':
      case '=':
        userTarget.zoom = Math.max(0.28, Math.min(6, userTarget.zoom * 0.9));
        break;
      case '-':
      case '_':
        userTarget.zoom = Math.max(0.28, Math.min(6, userTarget.zoom * 1.1));
        break;
      case '0':
      case 'Home':
        userTarget.azimuth = 0;
        userTarget.elevation = 0;
        userTarget.zoom = 1;
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    userActive = true;
    settleTimer = 0;
  });

  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const upScreen = new THREE.Vector3();
  const focus = new THREE.Vector3();

  function update(dt: number) {
    // 自动旋转：让静止的点云与地表参考系的关系可见。
    // 但读者按住拖动时暂停：点云与地球一起转是同一套刚体，
    // 手上正在对位，画面自己还在漂会让人觉得「拖不住」。
    // 松手后按 3 倍时间常数缓慢恢复，不出现速度突变。
    spinRate += ((dragging ? 0 : spin) - spinRate) * (1 - Math.exp(-dt * (dragging ? 18 : 1.6)));
    spinAccum += spinRate * dt;

    // 用户增量向目标缓动
    const k = 1 - Math.exp(-dt * 7);
    userOffset.azimuth += (userTarget.azimuth - userOffset.azimuth) * k;
    userOffset.elevation += (userTarget.elevation - userOffset.elevation) * k;
    userOffset.zoom += (userTarget.zoom - userOffset.zoom) * k;

    // 手动操作停止 2.5 秒后，自动缓缓回到叙事机位
    if (userActive && !dragging) {
      settleTimer += dt;
      if (settleTimer > 2.5) {
        userTarget.azimuth *= 1 - Math.min(1, dt * 0.7);
        userTarget.elevation *= 1 - Math.min(1, dt * 0.7);
        userTarget.zoom += (1 - userTarget.zoom) * Math.min(1, dt * 0.5);
        if (
          Math.abs(userTarget.azimuth) < 0.002 &&
          Math.abs(userTarget.elevation) < 0.002 &&
          Math.abs(userTarget.zoom - 1) < 0.002
        ) {
          userTarget.azimuth = 0;
          userTarget.elevation = 0;
          userTarget.zoom = 1;
          userActive = false;
        }
      }
    }

    // 当前机位追赶目标机位。时间常数让镜头有质量感，不会瞬移。
    const follow = 1 - Math.exp(-dt * 2.4);
    current.azimuth += (target.azimuth - current.azimuth) * follow;
    current.elevation += (target.elevation - current.elevation) * follow;
    current.distance += (target.distance - current.distance) * follow;
    current.screenShift += (target.screenShift - current.screenShift) * follow;
    lift += (liftFromInset() - lift) * follow;

    const az = current.azimuth + userOffset.azimuth + spinAccum;
    const el = Math.max(-1.5, Math.min(1.5, current.elevation + userOffset.elevation));
    const dist = Math.max(
      minDistance,
      Math.min(maxDistance, current.distance * userOffset.zoom)
    );

    // 根据视口宽高比决定「半宽」对应的世界尺度，使 screenShift 在横竖屏下
    // 都推出同样比例的画面偏移。
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * dist;
    const halfW = halfH * camera.aspect;

    const cosEl = Math.cos(el);
    tmp.set(Math.cos(az) * cosEl, Math.sin(el), Math.sin(az) * cosEl);
    camera.position.copy(tmp.multiplyScalar(dist));

    // 视线目标从原点沿相机右方与上方反向平移：目标是屏幕上的一点，
    // 目标左移，地球在画面里就右移。screenShift > 0 即把地球推向右侧，
    // 为左栏文字让出净空。半宽换算保证「右移 30%」与窗口尺寸无关。
    //
    // 纵向同理：目标下移，地球在画面里就上移，抬升量由底部面板的净空
    // 反推（见 liftFromInset）。位移必须走相机自身的 up 轴而不是世界 Y 轴：
    // 仰角接近正上方俯视时两者几乎垂直，用世界 Y 抬升会退化成缩放。
    camera.up.set(0, 1, 0);
    fwd.copy(camera.position).negate().normalize();
    right.crossVectors(fwd, camera.up).normalize();
    upScreen.crossVectors(right, fwd).normalize();
    focus
      .copy(right)
      .multiplyScalar(-current.screenShift * halfW)
      .addScaledVector(upScreen, -lift * halfH);

    camera.lookAt(focus);
  }

  return {
    camera,
    setPose(pose: CameraPose) {
      target.azimuth = pose.azimuth;
      target.elevation = pose.elevation;
      target.distance = pose.distance;
      target.screenShift = pose.screenShift ?? 0;
    },
    setSpin(v: number) {
      spin = v;
    },
    update,
    get distance() {
      return camera.position.length() / SCENE_EARTH_RADIUS;
    },
    get isUserDriving() {
      return userActive;
    },
    get lastDragDistance() {
      return dragDistance;
    },
    commitUserPose() {
      userTarget.azimuth = userOffset.azimuth;
      userTarget.elevation = userOffset.elevation;
      userTarget.zoom = userOffset.zoom;
    },
    releaseUserControl() {
      userActive = false;
      userTarget.azimuth = 0;
      userTarget.elevation = 0;
      userTarget.zoom = 1;
    },
    setBottomInset(px) {
      bottomInsetPx = Math.max(0, px);
    },
  };
}
