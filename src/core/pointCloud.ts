import * as THREE from 'three';
import { SCENE_EARTH_RADIUS } from './globe';
import { EARTH_RADIUS_KM } from './orbit';

/**
 * 对象类别。取值与 scripts/build-runtime-data.mjs 中的编码一一对应。
 * 这是第一章的论证基础：同一批点，按类别着色后，「哪些还在工作」直接可见。
 */
export const CATEGORY = {
  WORKING_PAYLOAD: 0,
  DEAD_PAYLOAD: 1,
  ROCKET_BODY: 2,
  DEBRIS: 3,
  UNKNOWN: 4,
} as const;

export type CategoryId = (typeof CATEGORY)[keyof typeof CATEGORY];

/**
 * 台面配色。
 *
 * 结构与交互用单色（青），数据类别用一组语义色：颜色在这里承担信息编码，
 * 不是装饰。每个颜色的含义在页面上有对应图例，不靠观众猜测。
 */
export const PALETTE = {
  /** 结构层：网格、边框、标尺 */
  structure: 0x1d3d55,
  /** 交互高亮：唯一一个用于 UI 强调的色 */
  accent: 0x4fc3f7,
  /** 数据类别色 */
  category: [
    0x7ad4f5, // 工作中的载荷：冷青，数量最多，构成画面底色
    0xf0a94c, // 已停止工作的载荷：琥珀
    0xc98a9e, // 火箭残骸：灰玫瑰
    0xff6b35, // 碎片：警示橙，全片的核心对象
    0x5a6b78, // 未分类：中性灰
  ] as [number, number, number, number, number],
};

export interface PointLayerOptions {
  count: number;
  /** 逐点类别，决定着色 */
  categories: Float32Array;
  /** 逐点尺寸倍率，默认全 1 */
  sizes?: Float32Array;
  /** 基础点大小（参考距离处的屏幕像素） */
  baseSizePx?: number;
  /** 参考距离（场景单位），点在此距离处等于 baseSizePx */
  referenceDistance?: number;
  /** 整体不透明度 */
  opacity?: number;
  /** 亮度上限夹取，防止高密度区叠加后过曝 */
  maxSizePx?: number;
}

/**
 * 点云图层：把一批地固坐标（km）渲染为 GPU 点。
 *
 * 关键点：
 *   位置缓冲由调用方持有并原地更新，不重建几何体。
 *   类别在着色器里查表，切换「单色 / 分类别」只需改一个 uniform，
 *   不必重新上传上万条颜色数据。
 */
export class PointLayer {
  readonly points: THREE.Points;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly count: number;
  private readonly emphasis: Float32Array;

  constructor(opts: PointLayerOptions) {
    const { count, categories } = opts;
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.emphasis = new Float32Array(count).fill(1);

    const sizes = opts.sizes ?? new Float32Array(count).fill(1);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aCategory', new THREE.BufferAttribute(categories, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aEmphasis', new THREE.BufferAttribute(this.emphasis, 1));
    // 手动管理包围球：位置会被整体替换，让 three 自动计算会产生额外开销
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SCENE_EARTH_RADIUS * 120);

    const palette = PALETTE.category.map((hex) => new THREE.Color(hex));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uBaseSizePx: { value: opts.baseSizePx ?? 2.0 },
        uReferenceDistance: { value: opts.referenceDistance ?? SCENE_EARTH_RADIUS * 5 },
        uMinSizePx: { value: 1.0 },
        uMaxSizePx: { value: opts.maxSizePx ?? 7.0 },
        uOpacity: { value: opts.opacity ?? 0.95 },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
        // 0 = 全部同一颜色，1 = 按类别查表。中间值用于过渡。
        uCategoryMix: { value: 0 },
        uUniformColor: { value: new THREE.Color(0x7ad4f5) },
        uPalette: { value: palette },
        // 未强调的点被压暗的程度（0 = 不压暗）
        uDim: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aCategory;
        attribute float aSize;
        attribute float aEmphasis;

        varying vec3 vColor;
        varying float vEmphasis;

        uniform float uBaseSizePx;
        uniform float uReferenceDistance;
        uniform float uMinSizePx;
        uniform float uMaxSizePx;
        uniform float uPixelRatio;
        uniform float uCategoryMix;
        uniform float uDim;
        uniform vec3 uUniformColor;
        uniform vec3 uPalette[5];

        void main() {
          // 类别查表。整数索引在着色器里用逐级比较实现，避免依赖整型属性。
          int idx = int(aCategory + 0.5);
          vec3 byCategory = uPalette[0];
          if (idx == 1) byCategory = uPalette[1];
          else if (idx == 2) byCategory = uPalette[2];
          else if (idx == 3) byCategory = uPalette[3];
          else if (idx >= 4) byCategory = uPalette[4];

          vec3 base = mix(uUniformColor, byCategory, uCategoryMix);
          // 未被强调的点整体压暗，被强调的点略提亮，形成视觉层级
          vColor = base * mix(1.0 - uDim, 1.12, aEmphasis);
          vEmphasis = aEmphasis;

          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;

          float dist = max(-mv.z, 0.001);
          // 透视缩放：距离越远，屏幕上越小
          float px = uBaseSizePx * aSize * (uReferenceDistance / dist);
          px = clamp(px, uMinSizePx, uMaxSizePx);
          gl_PointSize = px * uPixelRatio;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vEmphasis;

        uniform float uOpacity;

        void main() {
          // 把方点修成圆点，边缘做一次软过渡
          vec2 uv = gl_PointCoord - 0.5;
          float d = dot(uv, uv);
          if (d > 0.25) discard;
          float core = 1.0 - smoothstep(0.05, 0.25, d);
          // 强调的点给一个更实的核心，边缘更利落
          float alpha = uOpacity * (0.55 + 0.45 * vEmphasis) * core;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    // 点云分布范围远大于地球，关闭视锥剔除避免整层被误剔
    this.points.frustumCulled = false;
  }

  get size(): number {
    return this.count;
  }

  /**
   * 用地固坐标（km）更新位置。
   * 场景中地球半径为 1，因此按同一比例缩放，轨道高度与地球大小的比例关系
   * 在视觉上是真实的。坐标轴按 three 的 Y 轴朝上约定重排。
   */
  updateFromEcef(ecef: Float32Array): void {
    const s = SCENE_EARTH_RADIUS / EARTH_RADIUS_KM;
    for (let i = 0; i < this.count; i += 1) {
      const o = i * 3;
      const x = ecef[o];
      if (Number.isNaN(x)) {
        // 解算失败的对象推到场景之外，等效于隐藏
        this.positions[o] = 1e6;
        this.positions[o + 1] = 1e6;
        this.positions[o + 2] = 1e6;
        continue;
      }
      // 地固系 X 指向本初子午线, Z 指向北极 → three: X 保持, Y 取 Z, Z 取 -Y
      this.positions[o] = x * s;
      this.positions[o + 1] = ecef[o + 2] * s;
      this.positions[o + 2] = -ecef[o + 1] * s;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** 0 = 全部同一颜色，1 = 按类别着色。用于章节内的过渡动画。 */
  setCategoryMix(v: number): void {
    this.material.uniforms.uCategoryMix.value = Math.max(0, Math.min(1, v));
  }

  /** 未强调点的压暗程度。0 = 全部同等亮度。 */
  setDim(v: number): void {
    this.material.uniforms.uDim.value = Math.max(0, Math.min(0.95, v));
  }

  /**
   * 按类别设置强调度：选中类别为 1，其余为 rest。
   * 用于「只看某一层」的对照视图。
   */
  emphasizeCategories(active: Set<number>, rest = 0): void {
    const attr = this.geometry.getAttribute('aEmphasis') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const cats = this.geometry.getAttribute('aCategory') as THREE.BufferAttribute;
    const catArr = cats.array as Float32Array;
    for (let i = 0; i < this.count; i += 1) {
      arr[i] = active.has(catArr[i]) ? 1 : rest;
    }
    attr.needsUpdate = true;
  }

  /** 全部恢复为同等强调。 */
  clearEmphasis(): void {
    this.emphasis.fill(1);
    (this.geometry.getAttribute('aEmphasis') as THREE.BufferAttribute).needsUpdate = true;
  }

  setOpacity(v: number): void {
    this.material.uniforms.uOpacity.value = v;
  }

  setUniformColor(hex: number): void {
    (this.material.uniforms.uUniformColor.value as THREE.Color).setHex(hex);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
