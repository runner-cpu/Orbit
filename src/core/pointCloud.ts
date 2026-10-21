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
  /**
   * 类别配色表。默认用台面配色，但第二到四章要用同一套着色机制
   * 表达不同的分类（碎片按高度层、按所属碎片群），因此开放覆盖。
   * 传入 1-5 个色值即可，缺的位置沿用默认值。
   */
  palette?: number[];
  /**
   * 逐点发射年份。给了它才能用 setYearMax 做「按年份逐步出现」：
   * 同一条点云，切到不同年份就只剩当年已在轨的那些，第二章需要这个。
   * 不给则该能力自动关闭（阈值置为无穷大），不产生额外开销。
   */
  launchYears?: Float32Array;
  /**
   * 逐点辅助量，配合 setMetricRange 做筛选。
   * 第三章按近地点分层、第四章按倾角分层都用它。
   * 它只参与筛选，不参与着色：着色一律走 categories 的查表机制，
   * 这样「哪一类被显示」与「哪一类是什么颜色」是两个独立开关。
   */
  metrics?: Float32Array;
  /**
   * 逐点分组号，配合 setGroupRange 做筛选。
   *
   * 为什么不复用 metrics 那一条通道：第三章要同时表达两件事，
   * 「这是风云一号C 这一个群」与「只看 750-850 这一层」。
   * 共用一条通道时后写的会覆盖先写的，于是用户一点直方图选层，
   * 群筛选就没了，画面从「只剩一个群」变成「三个群里挑一层」。
   * 两条通道并行之后，群由场景表定，层由用户定，互不干扰。
   */
  groups?: Float32Array;
  /** 基础点大小（参考距离处的屏幕像素） */
  baseSizePx?: number;
  /** 参考距离（场景单位），点在此距离处等于 baseSizePx */
  referenceDistance?: number;
  /** 整体不透明度 */
  opacity?: number;
  /** 亮度上限夹取，防止高密度区叠加后过曝 */
  maxSizePx?: number;
  /**
   * 逐点归一化寿命（0-1）。第五章用它把「按高度层的清除速度」落到具体点上：
   * 拖动时间滑块时，低层的点先消失，高层的几乎不动。
   *
   * 语义：这个数就是「该点在多少年后消失」除以时间轴的跨度（200 年）。
   * 1 表示在这 200 年里不会消失（观测期内该高度层没有可测的清除）。
   *
   * 为什么点用确定性哈希取样而不是 Math.random：画面必须在同一时刻永远一致。
   * 哈希保证「哪一个点先消失」在每次渲染、每次刷新后都相同，
   * 滑块来回拖动时不会出现点位闪烁。
   */
  lifetimes?: Float32Array;
  /**
   * 是否写入深度。点云之间需要互相遮挡时开，单层叠加时关。
   * 默认关，配合加法混合得到「光点叠加」的观感。
   */
  depthWrite?: boolean;
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
    this.geometry.setAttribute(
      'aYear',
      new THREE.BufferAttribute(opts.launchYears ?? new Float32Array(count), 1)
    );
    this.geometry.setAttribute(
      'aMetric',
      new THREE.BufferAttribute(opts.metrics ?? new Float32Array(count), 1)
    );
    this.geometry.setAttribute(
      'aGroup',
      new THREE.BufferAttribute(opts.groups ?? new Float32Array(count).fill(-1), 1)
    );
    this.geometry.setAttribute(
      'aLifetime',
      new THREE.BufferAttribute(opts.lifetimes ?? new Float32Array(count).fill(1), 1)
    );
    // 手动管理包围球：位置会被整体替换，让 three 自动计算会产生额外开销
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SCENE_EARTH_RADIUS * 120);

    // 配色表：调用方给的色值覆盖默认值，缺的位置沿用默认。
    // 这样一个图层可以只用 3 个颜色（第四、五章），也可以继续用 5 个（第一章）。
    const hexes = PALETTE.category.slice() as number[];
    if (opts.palette) {
      for (let i = 0; i < Math.min(opts.palette.length, hexes.length); i += 1) {
        hexes[i] = opts.palette[i];
      }
    }
    const palette = hexes.map((hex) => new THREE.Color(hex));

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
        // 年份上限：只显示发射年 ≤ 该值的点。默认 +∞ 表示不筛选。
        uYearMax: { value: Number.POSITIVE_INFINITY },
        // 辅助量筛选区间，默认全开
        uMetricRange: { value: new THREE.Vector2(-1e9, 1e9) },
        // 分组筛选区间，默认全开（-1 的分组号不落在任何区间里时也不会被误筛）
        uGroupRange: { value: new THREE.Vector2(-1e9, 1e9) },
        // 类别位掩码：-1 = 不按类别筛，>=0 时第 n 位表示「第 n 类显示」。
        // 自由探索允许任意勾选组合，与分组掩码同一套做法。
        uCategoryMask: { value: -1 },
        // 分组位掩码：-1 = 不按组筛，>=0 时第 n 位表示「第 n 组显示」。
        // 自由探索允许任意勾选组合（例如同时看第 0 与第 2 组），
        // 连续的区间表达不了这种组合，因此另开一条掩码通道。
        uGroupMask: { value: -1 },
        // 时间推进：aLifetime ≤ uHorizon 的点已经消失。
        // 0 = 全部显示，1 = 到时间轴末端。第五章的时间滑块改这个值。
        uHorizon: { value: 0 },
        // 年份残影：第二章专用。打开后，发射年晚于 uYearMax 的点不消失，
        // 而是以极低的亮度留在画面上，读者于是能看见「还没出现的那一批」
        // 随着年份推进一点点被点亮，而不是凭空冒出一堆点。
        uGhost: { value: 0 },
        uGhostOpacity: { value: 0.13 },
      },
      vertexShader: /* glsl */ `
        attribute float aCategory;
        attribute float aSize;
        attribute float aEmphasis;
        attribute float aYear;
        attribute float aMetric;
        attribute float aGroup;
        attribute float aLifetime;

        varying vec3 vColor;
        varying float vEmphasis;
        varying float vGhost;

        uniform float uBaseSizePx;
        uniform float uReferenceDistance;
        uniform float uMinSizePx;
        uniform float uMaxSizePx;
        uniform float uPixelRatio;
        uniform float uCategoryMix;
        uniform float uDim;
        uniform float uYearMax;
        uniform vec2 uMetricRange;
        uniform vec2 uGroupRange;
        uniform float uGroupMask;
        uniform float uCategoryMask;
        uniform float uHorizon;
        uniform float uGhost;
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

          // 两处筛选都放在顶点着色器里做。
          //
          // 为什么不上传新的缓冲区：年份与高度层是连续变化的（时间轴拖动、
          // 滑块调节），每次都重传一万多条数据会造成明显卡顿。
          // 这里只改两个 uniform，把筛选变成一次常量比较，代价接近零。
          //
          // 用距离原点外推而不是直接丢掉顶点：gl_PointSize 置 0 在某些驱动上
          // 仍会画出一个像素；推到裁剪空间之外是各平台一致的做法。
          bool yearOk = aYear <= uYearMax;
          // 分组位掩码：只对 debris 层生效（catalog 的 aGroup 为 -1，
          // 且永远不会打开掩码）。2^group 用 pow 实现，避免依赖整型位运算。
          bool categoryMaskOk = true;
          if (uCategoryMask >= 0.0) {
            categoryMaskOk =
              mod(floor(uCategoryMask / pow(2.0, aCategory)), 2.0) > 0.5;
          }
          bool groupMaskOk = true;
          if (uGroupMask >= 0.0) {
            groupMaskOk =
              aGroup >= 0.0 &&
              mod(floor(uGroupMask / pow(2.0, aGroup)), 2.0) > 0.5;
          }
          // 除年份外的其余筛选：残影判断要用到它，因此单独拆出来
          bool otherOk =
            aMetric >= uMetricRange.x &&
            aMetric <= uMetricRange.y &&
            aGroup >= uGroupRange.x &&
            aGroup <= uGroupRange.y &&
            aLifetime > uHorizon &&
            groupMaskOk &&
            categoryMaskOk;
          bool visible = yearOk && otherOk;

          // 残影只对「仅被年份挡住」的点生效。如果同时被高度、分组或寿命筛掉，
          // 说明当前这一步根本不该看到它，留下的淡色点会变成噪音。
          vGhost = (uGhost > 0.5 && !yearOk && otherOk) ? 1.0 : 0.0;

          if (!visible && vGhost < 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }

          gl_Position = projectionMatrix * mv;

          float dist = max(-mv.z, 0.001);
          // 透视缩放：距离越远，屏幕上越小
          float px = uBaseSizePx * aSize * (uReferenceDistance / dist);
          px = clamp(px, uMinSizePx, uMaxSizePx);
          // 残影压到 0.55 倍大小：同尺寸的淡点仍然会被读成「存在」，
          // 缩小之后它退到背景，读者第一眼看到的是已经点亮的那一批。
          if (vGhost > 0.5) px *= 0.55;
          gl_PointSize = px * uPixelRatio;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vEmphasis;
        varying float vGhost;

        uniform float uOpacity;
        uniform float uGhostOpacity;

        void main() {
          // 把方点修成圆点，边缘做一次软过渡
          vec2 uv = gl_PointCoord - 0.5;
          float d = dot(uv, uv);
          if (d > 0.25) discard;
          float core = 1.0 - smoothstep(0.05, 0.25, d);
          // 强调的点给一个更实的核心，边缘更利落
          float a = uOpacity * (0.55 + 0.45 * vEmphasis) * core;
          // 残影走自己的不透明度，不受类别强调影响：它表达的是「尚未发生」，
          // 与「是否被选中」不是同一件事，两者相乘会让它彻底看不见。
          if (vGhost > 0.5) a = uGhostOpacity * core;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: opts.depthWrite ?? false,
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

  /**
   * 只显示发射年 ≤ year 的点，其余隐藏。
   * 第二章的时间轴用它：同一条点云，年份往前推就是「当年已在轨的那些」。
   * 传 null 取消筛选。
   */
  setYearMax(year: number | null): void {
    this.material.uniforms.uYearMax.value = year ?? Number.POSITIVE_INFINITY;
  }

  /**
   * 年份残影开关。
   *
   * 打开后，被 uYearMax 挡住的那部分点不消失，而是以很低的不透明度留在原位。
   * 第二章需要它：否则读者拖年份轴时看到的是「一片空白里不断冒出新点」，
   * 无法判断这些点原来就在那里、只是还没发射。留下残影之后，
   * 「这些位置早就在画面里，只是要等到那一年才亮起来」这件事直接可见。
   * 其余章节一律关闭，否则筛选失效看起来像渲染错误。
   */
  setGhost(v: boolean): void {
    this.material.uniforms.uGhost.value = v ? 1 : 0;
  }

  /** 残影的不透明度，供低性能设备调低。 */
  setGhostOpacity(v: number): void {
    this.material.uniforms.uGhostOpacity.value = Math.max(0, Math.min(0.4, v));
  }

  /**
   * 只显示 metric 落在 [lo, hi] 内的点。
   * 第三章按近地点分层、第四章按倾角分层用它。
   * 传 null 取消筛选。
   */
  setMetricRange(lo: number | null, hi: number | null): void {
    const v = this.material.uniforms.uMetricRange.value as THREE.Vector2;
    v.set(lo ?? -1e9, hi ?? 1e9);
  }

  /**
   * 只显示分组号落在 [lo, hi] 内的点。
   * 第三章「只看风云一号C 这一个群」、第四章「只看两个撞击群」用它。
   * 传 null 取消筛选。
   */
  setGroupRange(lo: number | null, hi: number | null): void {
    const v = this.material.uniforms.uGroupRange.value as THREE.Vector2;
    v.set(lo ?? -1e9, hi ?? 1e9);
  }

  /**
   * 按分组位掩码筛选：null = 不筛，否则第 n 位为 1 表示第 n 组可见
   * （0 表示一组都不显示）。与 setGroupRange 并行使用：区间负责
   * 「连续的一段」，掩码负责「任意勾选组合」，自由探索的碎片群多选框用后者。
   */
  setGroupMask(mask: number | null): void {
    this.material.uniforms.uGroupMask.value =
      mask === null ? -1 : Math.max(0, Math.floor(mask));
  }

  get groupMask(): number {
    return this.material.uniforms.uGroupMask.value as number;
  }

  /**
   * 按类别位掩码筛选：null = 不筛，否则第 n 位为 1 表示第 n 类可见。
   * 与 emphasizeCategories 的区别：强调只是压暗，掩码是真的不画。
   * 自由探索的类别多选框要的是后者。
   */
  setCategoryMask(mask: number | null): void {
    this.material.uniforms.uCategoryMask.value =
      mask === null ? -1 : Math.max(0, Math.floor(mask));
  }

  get categoryMask(): number {
    return this.material.uniforms.uCategoryMask.value as number;
  }

  /**
   * 时间推进：aLifetime ≤ years/span 的点视为已经消失。
   * 传 0 表示全部保留，传 1 表示推到时间轴末端。
   * 第五章的时间加速滑块用它，于是低层的点先消失、高层的几乎不动。
   */
  setHorizon(v: number): void {
    this.material.uniforms.uHorizon.value = Math.max(0, Math.min(1, v));
  }

  /** 覆盖配色表。传 1-5 个色值，缺的位置保持原样。 */
  setPalette(hexes: number[], startIndex = 0): void {
    const arr = this.material.uniforms.uPalette.value as THREE.Color[];
    for (let i = 0; i < hexes.length; i += 1) {
      const k = startIndex + i;
      if (k >= 0 && k < arr.length) arr[k].setHex(hexes[i]);
    }
  }

  /** 当前的年份上限读数，供仪表与调试使用。 */
  get yearMax(): number {
    return this.material.uniforms.uYearMax.value as number;
  }

  /** 年份残影是否开启，供自动化校验确认第二章的可见状态。 */
  get ghost(): boolean {
    return (this.material.uniforms.uGhost.value as number) > 0.5;
  }

  /**
   * 当前的辅助量筛选区间，供仪表与调试使用。
   *
   * 为什么需要它：筛选在顶点着色器里完成，被筛掉的点不改变 draw call 数，
   * 因此「筛选到底生效没有」无法从渲染统计里读出来。把 uniform 暴露出来，
   * 自动化校验才能确认「点某一层」真的改了这个区间。
   */
  get metricRange(): { lo: number; hi: number } {
    const v = this.material.uniforms.uMetricRange.value as THREE.Vector2;
    return { lo: v.x, hi: v.y };
  }

  /** 当前的分组筛选区间，供仪表与调试使用。理由同 metricRange。 */
  get groupRange(): { lo: number; hi: number } {
    const v = this.material.uniforms.uGroupRange.value as THREE.Vector2;
    return { lo: v.x, hi: v.y };
  }

  /** 当前的时间推进量（0-1），供仪表与调试使用。 */
  get horizon(): number {
    return this.material.uniforms.uHorizon.value as number;
  }

  set pointSizeScale(v: number) {
    this.material.uniforms.uBaseSizePx.value = v;
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
