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

  let spin = 0;
  let spinAccum = 0;

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

  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const focus = new THREE.Vector3();

  function update(dt: number) {
    // 自动旋转：让静止的点云与地表参考系的关系可见
    spinAccum += spin * dt;

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

    // 视线目标从原点沿相机右方反向平移：目标是屏幕上的一点，
    // 目标左移，地球在画面里就右移。screenShift > 0 即把地球推向右侧，
    // 为左栏文字让出净空。半宽换算保证「右移 30%」与窗口尺寸无关。
    fwd.copy(camera.position).negate().normalize();
    right.crossVectors(fwd, camera.up).normalize();
    focus.copy(right).multiplyScalar(-current.screenShift * halfW);

    camera.up.set(0, 1, 0);
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
  };
}
