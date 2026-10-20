/**
 * 场景标注层：把「这一步在说什么」钉在球体上，而不是再写一段话。
 *
 * 为什么需要它：
 *   左栏已经压到每步一句话，但右栏仍然只有一团点。读者读到「400 到 600 公里
 *   这一薄层」时，视线里没有任何东西指出「这一层」在哪。标注层把高度环、
 *   轨道面与一个短标签挂到球体对应的位置：文字只有两行，剩下的信息由
 *   位置本身承担。
 *
 * 为什么用 DOM 而不是 WebGL 文字：
 *   标签需要跟随镜头做屏幕投影、避开球体背面、在窄屏上换边，这些在 DOM 里
 *   只是 transform；在 canvas 里要自己做命中、排版与高清缩放。
 *
 * 与 overlays.ts 的关系：
 *   标注的几何（哪一层、哪个轨道面）同时交给 overlays 画成三维环，
 *   两边共用同一份 SceneAnnotation，避免「标签指向 400 km、环却画在 500 km」。
 */

import * as THREE from 'three';
import { SCENE_EARTH_RADIUS } from './globe';

/** 地球赤道半径，用于把公里换算成场景单位。 */
const EARTH_RADIUS_KM = 6378.137;

/** 标签文字可以随运行时状态变化（第二章的年份、第五章的剩余量）。 */
export interface AnnotationContext {
  yearMax: number | null;
  years: number;
  remaining: number;
}

type AnnoText = string | ((ctx: AnnotationContext) => string);

export type SceneAnnotation =
  | {
      /** 赤道面上的高度环带。lo/hi 为近地点公里数。 */
      kind: 'band';
      loKm: number;
      hiKm: number;
      color: number;
      title: AnnoText;
      value: AnnoText;
      /** 标签挂在环带的哪一侧：1 = 右，-1 = 左 */
      side: 1 | -1;
    }
  | {
      /** 一条倾斜的轨道面圆环。 */
      kind: 'orbit';
      inclDeg: number;
      color: number;
      title: AnnoText;
      value: AnnoText;
      side: 1 | -1;
    }
  | {
      /** 挂在球体临边某一高度上的单点标签，没有环。 */
      kind: 'limb';
      altKm: number;
      color: number;
      title: AnnoText;
      value: AnnoText;
      side: 1 | -1;
    };

/** 屏幕上的一块禁区（上下 HUD、仪器面板）。 */
export interface AvoidRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AnnotationLayer {
  /** 换一步时重建标签。几何与文字都在这里落定。 */
  setSpecs(specs: SceneAnnotation[]): void;
  /** 每帧调用：把标签投影到屏幕并避开球体背面。 */
  update(camera: THREE.PerspectiveCamera, ctx: AnnotationContext): void;
  /**
   * 屏幕上需要避让的矩形：仪器面板与上下两条 HUD。
   *
   * 传数组而不是单个矩形，因为除了右下角的仪器面板，页眉与页脚也是
   * 固定在视口上的满宽条。球体在这些位置投出来的标签会直接压在
   * 读数或章节刻度上，只避让面板救不到。
   */
  setAvoidRects(rects: AvoidRect[]): void;
  /** 尾页静音 */
  setMuted(v: boolean): void;
}

interface Item {
  el: HTMLElement;
  titleEl: HTMLElement;
  valueEl: HTMLElement;
  spec: SceneAnnotation;
  lastTitle: string;
  lastValue: string;
  /** 标签实测宽度（像素），用于在视口边缘把标签翻到另一侧。 */
  width: number;
  /** 标签实测高度（像素），用于贴住上下边缘时不让文字被裁掉。 */
  height: number;
  /** 当前实际挂在哪一侧；与 spec.side 不同表示已因贴边而翻转。 */
  side: 1 | -1;
  /** orbit 用的采样点，避免每帧重新算三角函数 */
  samples?: THREE.Vector3[];
}

/** 轨道面圆环的采样点。半径略高于球面，避免与海岸线打架。 */
function orbitSamples(inclDeg: number): THREE.Vector3[] {
  const inc = (inclDeg * Math.PI) / 180;
  const r = SCENE_EARTH_RADIUS * 1.018;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < 128; i += 1) {
    const t = (i / 128) * Math.PI * 2;
    out.push(
      new THREE.Vector3(
        Math.cos(t) * r,
        Math.sin(t) * Math.sin(inc) * r,
        Math.sin(t) * Math.cos(inc) * r
      )
    );
  }
  return out;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function textOf(t: AnnoText, ctx: AnnotationContext): string {
  return typeof t === 'function' ? t(ctx) : t;
}

export function createAnnotationLayer(host: HTMLElement): AnnotationLayer {
  let items: Item[] = [];
  /** 需要避让的屏幕矩形（仪器面板与上下 HUD）。空数组表示不避让。 */
  let avoid: AvoidRect[] = [];

  const camPos = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const anchor = new THREE.Vector3();

  /**
   * 锚点是否在球体正面。
   *
   * 判据：从锚点指向相机的方向与锚点法线同向。锚点半径都大于 1，
   * 因此这个判据等价于「相机能看到它」，不需要做射线求交。
   */
  function facingCamera(pos: THREE.Vector3): boolean {
    toCam.copy(camPos).sub(pos);
    return pos.dot(toCam) > 0;
  }

  return {
    setSpecs(specs) {
      host.replaceChildren();
      items = specs.map((spec) => {
        const el = document.createElement('div');
        el.className = 'anno';
        el.dataset.side = spec.side === 1 ? 'right' : 'left';
        el.style.color = hex(spec.color);

        const dot = document.createElement('span');
        dot.className = 'anno-dot';

        const body = document.createElement('span');
        body.className = 'anno-body';
        const titleEl = document.createElement('span');
        titleEl.className = 'anno-title';
        const valueEl = document.createElement('span');
        valueEl.className = 'anno-value';
        body.append(titleEl, valueEl);

        // 左侧标签把文字放在点的左边：文字始终朝画面外侧展开，
        // 不会压到球体上。翻转由 data-side + CSS 的 row-reverse 完成，
        // 这样标签贴到视口边缘时可以在不重建 DOM 的情况下换边。
        el.append(dot, body);

        host.append(el);
        return {
          el,
          titleEl,
          valueEl,
          spec,
          lastTitle: '',
          lastValue: '',
          width: el.offsetWidth,
          height: el.offsetHeight,
          side: spec.side,
          samples: spec.kind === 'orbit' ? orbitSamples(spec.inclDeg) : undefined,
        };
      });
    },

    update(camera, ctx) {
      if (!items.length) return;
      camera.getWorldPosition(camPos);
      const w = window.innerWidth;
      const h = window.innerHeight;

      for (const item of items) {
        const spec = item.spec;
        let pos: THREE.Vector3 | null = null;

        if (spec.kind === 'band' || spec.kind === 'limb') {
          const altKm = spec.kind === 'limb' ? spec.altKm : (spec.loKm + spec.hiKm) / 2;
          const r = SCENE_EARTH_RADIUS * (1 + altKm / EARTH_RADIUS_KM);
          // 锚点取在「镜头方位角 + 侧向偏移」处：它永远落在环带朝向读者的
          // 那一侧边缘，不会随球体转到背面。
          const az = Math.atan2(camPos.z, camPos.x);
          const a = az + spec.side * (spec.kind === 'limb' ? 0.85 : 0.62);
          const y = spec.kind === 'limb' ? r * 0.22 : 0;
          anchor.set(Math.cos(a) * r, y, Math.sin(a) * r);
          pos = anchor;
        } else if (item.samples) {
          // 轨道面：在采样点里挑屏幕横向最靠外、且朝向相机的那一个。
          let best = -Infinity;
          let bestPos: THREE.Vector3 | null = null;
          for (const s of item.samples) {
            if (!facingCamera(s)) continue;
            probe.copy(s).project(camera);
            if (probe.z > 1) continue;
            const score = probe.x * spec.side;
            if (score > best) {
              best = score;
              bestPos = s;
            }
          }
          pos = bestPos;
        }

        if (!pos || !facingCamera(pos)) {
          item.el.dataset.visible = 'false';
          continue;
        }

        probe.copy(pos).project(camera);
        if (probe.z > 1) {
          item.el.dataset.visible = 'false';
          continue;
        }

        const x = ((probe.x + 1) / 2) * w;
        const y = ((1 - probe.y) / 2) * h;
        // 锚点远远跑出视口就整条收起；只差几十像素时把锚点夹回边缘，
        // 标签仍然贴着画面边，读者看得出它指的是屏幕外那一侧。
        if (x < -80 || x > w + 80 || y < -40 || y > h + 40) {
          item.el.dataset.visible = 'false';
          continue;
        }
        // 动态文字只在变化时写 DOM：第二章拖年份、第五章推时间时，
        // 读数每帧都在变，不比较就会每帧触发一次排版。
        // 先写文字再算位置：翻边与纵向夹取都要用当前这一帧的真实宽高，
        // 否则动态读数刚变长的那一帧会按旧宽度判断，标签会短暂越界。
        const title = textOf(spec.title, ctx);
        const value = textOf(spec.value, ctx);
        let changed = false;
        if (title !== item.lastTitle) {
          item.lastTitle = title;
          item.titleEl.textContent = title;
          changed = true;
        }
        if (value !== item.lastValue) {
          item.lastValue = value;
          item.valueEl.textContent = value;
          changed = true;
        }
        // 文字变了宽高也会变。只在文字变化时量一次，
        // 不每帧读 offsetWidth/offsetHeight，避免把布局同步拖进渲染循环。
        if (changed || item.width === 0) {
          const measuredW = item.el.offsetWidth;
          const measuredH = item.el.offsetHeight;
          if (measuredW > 0) item.width = measuredW;
          if (measuredH > 0) item.height = measuredH;
        }

        const margin = 8;
        const gap = 10;
        const ax = Math.max(margin, Math.min(w - margin, x));
        // 纵向同理：标签以锚点为中线上下展开，锚点只跑出几十像素时
        // 半条标签会被视口切掉。把中心夹回「上边距 + 半高」以内，
        // 整条标签始终完整可见，指向仍然正确。
        // 首帧还没量到文字高度（setSpecs 时是空标签），按两行标签估一个值，
        // 下一帧量到真实高度就替换掉。
        const half = (item.height || 38) / 2;
        let ay = Math.max(margin + half, Math.min(h - margin - half, y));

        // 标签贴到视口边缘时翻到另一侧，而不是被裁掉。
        // 窄屏上「撞击高度」这类挂在球右侧的标注经常只剩半个字。
        const fitsRight = ax + gap + item.width <= w - margin;
        const fitsLeft = ax - gap - item.width >= margin;
        if (item.side === 1 && !fitsRight && fitsLeft) item.side = -1;
        else if (item.side === -1 && !fitsLeft && fitsRight) item.side = 1;
        // 回到足够宽裕的位置再翻回原侧，避免在临界点反复抖动。
        if (item.side !== spec.side) {
          const home =
            spec.side === 1
              ? ax + gap + item.width <= w - margin - 16
              : ax - gap - item.width >= margin + 16;
          if (home) item.side = spec.side;
        }
        item.el.dataset.side = item.side === 1 ? 'right' : 'left';

        // 避开屏幕上的固定条带：右下角的仪器面板、页眉、页脚。
        // 它们固定在视口上，标签是跟着球投影走的，两者在「撞击面」这类
        // 镜头压低、球心偏下的场景里必然相遇：一个挂在下半球的标签
        // 会正好落在面板背后，读者只能看到半个字。
        //
        // 做法是只沿纵向挪：横向一挪，标签就离开了它指的那个点。
        // 每块禁区先试往上让开，上方放不下再试往下；挪完可能又撞上
        // 另一块（页眉与面板同时压过来），所以循环到不再相交为止，
        // 循环次数以禁区数量为上限，避免两块禁区要求反向移动时来回弹。
        for (let pass = 0; pass < avoid.length; pass += 1) {
          let moved = false;
          for (const rect of avoid) {
            const left = item.side === 1 ? ax + gap : ax - gap - item.width;
            const right = item.side === 1 ? ax + gap + item.width : ax - gap;
            const top = ay - half;
            const bottom = ay + half;
            const hits =
              right > rect.left && left < rect.right && bottom > rect.top && top < rect.bottom;
            if (!hits) continue;
            const above = rect.top - 6 - half;
            const below = rect.bottom + 6 + half;
            if (above >= margin + half) ay = above;
            else if (below <= h - margin - half) ay = below;
            else continue;
            moved = true;
          }
          if (!moved) break;
        }

        item.el.style.transform =
          item.side === 1
            ? `translate3d(${(ax + gap).toFixed(1)}px, ${ay.toFixed(1)}px, 0) translateY(-50%)`
            : `translate3d(${(ax - gap).toFixed(1)}px, ${ay.toFixed(1)}px, 0) translate(-100%, -50%)`;
        item.el.dataset.visible = 'true';
      }
    },

    setAvoidRects(rects) {
      avoid = rects;
    },

    setMuted(v) {
      host.dataset.muted = String(v);
    },
  };
}
