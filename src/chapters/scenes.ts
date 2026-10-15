/**
 * 全片场景表。
 *
 * 职责：把「叙事步骤想要什么画面」翻译成具体的镜头与图层参数。
 * 五个章节共用这一张表，因为镜头在章节之间是连续的：第二章结尾的机位
 * 就是第三章开头的位置，如果两个章节各自维护一套状态，接缝处必然跳动。
 *
 * 设计约定：
 *   所有过渡都写在「目标值」上，由相机与图层内部缓动。滚动只负责设定目标，
 *   不直接写当前帧的数值，因此快速滚动不会产生跳动。
 *   章节之间不重置状态，下一个场景把需要的字段全部显式写出来，
 *   没写的字段沿用上一个场景的值。这条规则让跨章节的图层延续成为默认行为。
 */

import type { CameraPose, CameraRig } from '../core/camera';
import { CATEGORY, PALETTE } from '../core/pointCloud';
import type { PointLayer } from '../core/pointCloud';
import type { Globe } from '../core/globe';
import type { StepState } from '../core/scrollStory';
import type { HistoryData } from '../core/data';
import type { InstrumentId, InstrumentIntent } from '../core/instrument';

/** 三个碎片群在 debris 点云中的 groupId，与构建脚本的 DEBRIS_FILES 顺序一致。 */
export const GROUP = { FENGYUN1C: 0, COSMOS2251: 1, IRIDIUM33: 2 } as const;

/**
 * 碎片层的专用配色。
 *
 * 为什么不用章节一的类别色：那张表把「碎片」统一编成警示橙，
 * 而第三到五章要看的是碎片内部的差异（哪个群、哪一层），
 * 橙色在这里不够用。三个群各自的颜色在第三章的单群里只起统一作用，
 * 到第四章才真正承担编码职责。
 */
export const DEBRIS_PALETTE = {
  fengyun1c: 0xff7a45,
  cosmos2251: 0x4fc3f7,
  iridium33: 0xffd54f,
};

/**
 * 每个场景标识对应的状态。
 *
 * 镜头约定：
 *   视距用「地球半径倍数」表达。桌面端左侧有一条约 46ch 宽的叙事栏，
 *   因此所有机位都带 screenShift，把地球推到画面右侧，避免点云被文字压住。
 *   screenShift 的单位是视口半宽：0.28 在 1600px 宽的窗口里把球心推到
 *   约 62% 处，球体右缘留有余量，不会被裁掉。
 */
export interface SceneState {
  pose: CameraPose;
  /** 编目点云着色：0 单一色，1 按类别 */
  categoryMix: number;
  /** 非选中类别的压暗程度 */
  dim: number;
  /** 强调哪些类别；null = 全部同等 */
  emphasize: Set<number> | null;
  /** 参考图层（经纬网格、海岸线、赤道环）是否可见 */
  referenceLayers: boolean;
  /** 地球自动旋转速度（弧度/秒） */
  spin: number;
  /** 编目点云整体透明度 */
  opacity: number;
  /** 编目点云是否显示 */
  catalogVisible?: boolean;
  /** 编目点云的年份上限：null = 不筛选。第二章用 */
  yearMax?: number | null;

  /** 碎片点云是否显示 */
  debrisVisible?: boolean;
  /** 碎片点云整体透明度 */
  debrisOpacity?: number;
  /** 碎片按哪个通道筛选：groupId 或 nearPerigee */
  debrisFilter?: { lo: number; hi: number } | null;
  /** 碎片生存阈值：0 = 全部显示，1 = 全部隐藏。第五章用 */
  horizon?: number;

  /**
   * 这一步挂哪台仪器。null 或不写 = 没有仪器。
   *
   * 为什么仪器属于场景表：仪器与镜头是同一件事的两面。第三章把镜头压到
   * 侧视、只留 750-850 那一层，同时就该有一张近地点直方图在旁边解释
   * 「为什么是这一段」。分开维护会立刻出现「镜头已经切了、仪器还是上一台」。
   */
  instrument?: InstrumentId | null;
}

/** 场景表。键是文案层在 StepCopy.scene 中声明的标识。 */
const TABLE: Record<string, SceneState> = {
  // ---------- 第一章 ----------
  establish: {
    pose: { azimuth: 0.62, elevation: 0.34, distance: 5.2, screenShift: 0.28 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.028,
    opacity: 0.95,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: false,
  },

  wide: {
    pose: { azimuth: 0.95, elevation: 0.52, distance: 8.4, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.022,
    opacity: 0.9,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: false,
  },

  locatable: {
    pose: { azimuth: 1.35, elevation: 0.18, distance: 3.8, screenShift: 0.3 },
    categoryMix: 0.35,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.016,
    opacity: 0.95,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: false,
  },

  band: {
    pose: { azimuth: 1.62, elevation: 0.1, distance: 2.9, screenShift: 0.26 },
    categoryMix: 0.8,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.01,
    opacity: 1,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: false,
    instrument: 'altitude',
  },

  status: {
    pose: { azimuth: -0.35, elevation: 0.26, distance: 3.5, screenShift: 0.3 },
    categoryMix: 1,
    dim: 0.55,
    emphasize: new Set<number>([
      CATEGORY.DEAD_PAYLOAD,
      CATEGORY.ROCKET_BODY,
      CATEGORY.DEBRIS,
      CATEGORY.UNKNOWN,
    ]),
    referenceLayers: true,
    spin: 0.008,
    opacity: 1,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: false,
  },

  recap: {
    pose: { azimuth: 0.3, elevation: 0.44, distance: 6.4, screenShift: 0.3 },
    categoryMix: 1,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.026,
    opacity: 0.95,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: false,
  },

  // ---------- 第二章：数量不是线性增长 ----------
  //
  // 这一章用的是同一个编目点云，只是给每个点加了一道「发射年 ≤ 当前年」的闸门。
  // 复用的理由是：观众看的必须是同一批点，否则「现在这么多是从那时这么长出来的」
  // 这句话就不成立，换成两批不同的数据，画面再漂亮也只是示意图。
  'growth-early': {
    pose: { azimuth: 0.3, elevation: 0.44, distance: 6.4, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.02,
    opacity: 0.95,
    catalogVisible: true,
    yearMax: 1960,
    debrisVisible: false,
  },

  'growth-payload': {
    pose: { azimuth: 0.85, elevation: 0.3, distance: 5.6, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.018,
    opacity: 0.95,
    catalogVisible: true,
    yearMax: 1980,
    debrisVisible: false,
    instrument: 'year',
  },

  'growth-fragmentation': {
    // 侧倾到近赤道视角：碎片带的厚度与密度在这一角度下最清楚
    pose: { azimuth: 1.5, elevation: 0.12, distance: 3.6, screenShift: 0.28 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.012,
    opacity: 1,
    catalogVisible: true,
    yearMax: 2000,
    debrisVisible: false,
  },

  'growth-constellation': {
    pose: { azimuth: 0.5, elevation: 0.62, distance: 4.4, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.03,
    opacity: 0.95,
    catalogVisible: true,
    yearMax: 2020,
    debrisVisible: false,
  },

  'growth-now': {
    pose: { azimuth: 0.3, elevation: 0.44, distance: 6.4, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.026,
    opacity: 0.95,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: false,
  },

  // ---------- 第三章：风云一号C ----------
  //
  // 从第二章的「现在」直接推到只剩一个碎片群。镜头逐层贴近：
  // 先看到它是一层壳，再看到这层壳的厚度，最后侧过来量厚度。
  'fy-arrive': {
    pose: { azimuth: 0.3, elevation: 0.44, distance: 6.4, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.02,
    opacity: 0.28,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    debrisFilter: { lo: GROUP.FENGYUN1C - 0.5, hi: GROUP.FENGYUN1C + 0.5 },
    horizon: 0,
  },

  'fy-shell': {
    // 压到 3.0：整层壳刚好占满画面高度，能读出它是一个环而不是一团
    pose: { azimuth: 1.15, elevation: 0.2, distance: 3.0, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.012,
    opacity: 0.14,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    debrisFilter: { lo: GROUP.FENGYUN1C - 0.5, hi: GROUP.FENGYUN1C + 0.5 },
    horizon: 0,
    instrument: 'perigee',
  },

  'fy-band': {
    // 只留 750-850 km 这一层。其余碎片被筛掉后，双峰的位置直接可见。
    pose: { azimuth: 1.5, elevation: 0.14, distance: 2.5, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.008,
    opacity: 0.06,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    debrisFilter: { lo: GROUP.FENGYUN1C - 0.5, hi: GROUP.FENGYUN1C + 0.5 },
    horizon: 0,
  },

  'fy-edge': {
    // 侧视（仰角接近 0）：高度差被压成画面的纵向距离，厚度读得出来
    pose: { azimuth: 1.62, elevation: 0.02, distance: 2.35, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.004,
    opacity: 0.04,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    debrisFilter: { lo: GROUP.FENGYUN1C - 0.5, hi: GROUP.FENGYUN1C + 0.5 },
    horizon: 0,
  },

  // ---------- 第四章：两个碎片群 ----------
  'impact-dual': {
    // 退到能同时装下两个群的距离。两个群近地点相差不大，
    // 差别在轨道面朝向，所以退远比贴近更能看出「两层」
    pose: { azimuth: 0.95, elevation: 0.28, distance: 3.4, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.014,
    opacity: 0.1,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    // 两个群一起显示：73.5-86.5° 这一段把两个群都包住，但排掉风云一号C
    debrisFilter: { lo: GROUP.COSMOS2251 - 0.5, hi: GROUP.IRIDIUM33 + 0.5 },
    horizon: 0,
  },

  'impact-plane': {
    // 沿交线方向看：两个轨道面几乎正交，在这个角度下交叉成 X
    pose: { azimuth: 0.15, elevation: 0.05, distance: 2.7, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.006,
    opacity: 0.06,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    debrisFilter: { lo: GROUP.COSMOS2251 - 0.5, hi: GROUP.IRIDIUM33 + 0.5 },
    horizon: 0,
    instrument: 'plane',
  },

  // ---------- 第五章：它们不会自己消失 ----------
  //
  // 镜头停在能同时看出「层」与「全球环带」的位置，之后不再动，
  // 让时间成为唯一的变化量。观众看的是同一张画面在四个时刻的样子。
  'decay-now': {
    pose: { azimuth: 1.2, elevation: 0.2, distance: 2.9, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.006,
    opacity: 0.06,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    debrisFilter: null,
    horizon: 0,
  },

  'decay-observe': {
    // 讲「过去这十几年清除得怎么样」时的机位。时间停在现在，画面不动。
    pose: { azimuth: 1.2, elevation: 0.2, distance: 2.9, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.006,
    opacity: 0.06,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    debrisFilter: null,
    horizon: 0,
    instrument: 'decay',
  },

  'decay-project': {
    // 讲外推时的机位。与上一步完全相同，唯一的变量是时间，
    // 读者要看的正是「同一张画面在四个时刻的样子」。
    pose: { azimuth: 1.2, elevation: 0.2, distance: 2.9, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: false,
    spin: 0.004,
    opacity: 0.06,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 1,
    debrisFilter: null,
    horizon: 0,
    instrument: 'decay',
  },

  'decay-kessler': {
    pose: { azimuth: 0.6, elevation: 0.4, distance: 5.2, screenShift: 0.3 },
    categoryMix: 0,
    dim: 0,
    emphasize: null,
    referenceLayers: true,
    spin: 0.02,
    opacity: 0.2,
    catalogVisible: true,
    yearMax: null,
    debrisVisible: true,
    debrisOpacity: 0.9,
    debrisFilter: null,
    horizon: 0,
  },
};

/** 找不到标识时退回概览机位，保证任何时候都有合法状态。 */
function stateFor(scene: string): SceneState {
  return TABLE[scene] ?? TABLE.establish;
}

export interface ChapterScenes {
  /**
   * 每个渲染帧调用。
   *
   * 为什么 scene 与 state 分开传：state.id 是「叙事步骤」标识，
   * scene 是该步骤想要的「镜头状态」标识。两者不是同一个字符串，
   * 且一个镜头状态可以被多个步骤复用，因此不能在场景层按 state.id 反查。
   */
  apply(state: StepState, scene: string): void;
  /** 当前镜头状态标识，供读数与调试使用 */
  readonly currentSceneId: string;
  /** 当前生效的年份上限，null 表示不筛选。第二章的读数用它 */
  readonly yearMax: number | null;
  /** 当前时间推进量（0-1），第五章的读数用它 */
  readonly horizon: number;
  /** 当前场景该挂哪台仪器。null = 不挂。主循环用它切仪器 */
  readonly instrument: InstrumentId | null;
  /**
   * 接收仪器的用户意图。
   *
   * 仪器不直接改 PointLayer，而是把「用户点了 400-600 公里这一层」
   * 这件事抛到这里，由场景层决定怎么落到 uniform 上。这样仪器不需要知道
   * 点云的接口，点云也不需要知道仪器的存在。
   */
  applyIntent(intent: InstrumentIntent): void;
}

export function createChapterScenes(
  rig: CameraRig,
  catalog: PointLayer,
  debris: PointLayer,
  globe: Globe,
  history: HistoryData
): ChapterScenes {
  let currentSceneId = 'establish';
  let currentEmphasis: Set<number> | null = null;
  let yearMax: number | null = null;
  /** 当前场景标识，applyIntent 需要按它判断用户输入该落到哪一层 */
  let sceneNow = 'establish';

  /**
   * 用户输入覆盖层。
   *
   * 三处覆盖分别对应三台会发意图的仪器。为什么需要覆盖层而不是直接改
   * 场景表：用户的输入优先于场景表，但必须在切场景时失效。否则用户把
   * 年份轴拖到 1980 之后继续滚动，下一步会带着 1980 这个残留状态进去，
   * 画面与文案就对不上了。
   *
   * reset 把三项全部清空，切仪器时由宿主调用一次。
   */
  const override = {
    /** 第一章：只看某一段高度。null = 不筛选 */
    band: null as { lo: number; hi: number | null } | null,
    /** 第二章：用户拖到的年份。null = 跟随场景 */
    year: null as number | null,
    /** 第三章：用户选中的近地点档。null = 不筛选 */
    bin: null as { lo: number; hi: number } | null,
    /** 第四章：用户转动到的方位角。null = 跟随场景 */
    azimuth: null as number | null,
    /** 第五章：用户拖到的时间。null = 跟随场景 */
    years: null as number | null,
  };

  function clearOverride() {
    override.band = null;
    override.year = null;
    override.bin = null;
    override.azimuth = null;
    override.years = null;
  }

  /**
   * 把用户意图翻译成图层参数。
   *
   * 每一项都同时改「哪个点可见」与「镜头怎么配合」：只筛点不动镜头，
   * 读者会以为是自己看漏了；只动镜头不筛点，则什么都没发生。
   */
  function applyIntent(intent: InstrumentIntent) {
    switch (intent.kind) {
      case 'reset':
        clearOverride();
        break;

      case 'altitude-band': {
        override.band = { lo: intent.lo, hi: intent.hi };
        // 编目层用近地点做区间筛选。upper 为 null 时给一个大数，
        // 让「2000 公里以上」这一段也能被选中。
        catalog.setMetricRange(intent.lo, intent.hi ?? 1e9);
        break;
      }

      case 'year': {
        override.year = intent.year;
        yearMax = intent.year;
        catalog.setYearMax(intent.year);
        break;
      }

      case 'perigee-bin': {
        override.bin = { lo: intent.lo, hi: intent.hi };
        // 碎片层的 aMetric 存的是近地点，直接按它筛
        debris.setMetricRange(intent.lo, intent.hi);
        break;
      }

      case 'plane-angle': {
        override.azimuth = intent.azimuth;
        // 只改方位角，其余机位参数沿用当前场景
        const base = stateFor(sceneNow).pose;
        rig.setPose({
          ...base,
          azimuth: intent.azimuth,
          screenShift: (base.screenShift ?? 0) * shiftFactor(),
        });
        break;
      }

      case 'horizon': {
        override.years = intent.years;
        debris.setHorizon(horizonFor(intent.years));
        break;
      }
    }
  }

  // 窄屏时叙事栏移到画面底部，地球不需要再向右让位。
  // 每次 apply 时读取窗口宽度：滚动过程中窗口尺寸变化会立即生效。
  function shiftFactor(): number {
    return window.innerWidth > 1080 ? 1 : 0;
  }

  /**
   * 第五章的时间外推。
   *
   * 把「时间推进 N 年」翻译成一个 0-1 的归一化时间。每个碎片在构建期
   * 已经算好自己在第几年消失（按所在高度层的实测时间常数取样），除以
   * 时间轴跨度后写进 aLifetime，于是同一个滑块能同时表达
   * 「低层清空、高层纹丝不动」这件事。
   */
  const MAX_HORIZON = 200;
  function horizonFor(years: number): number {
    if (years <= 0) return 0;
    return Math.min(1, years / MAX_HORIZON);
  }

  /**
   * 章节内是否让时间随滚动推进。
   *
   * 只给「往后推」这一步。前面的两步（按层看、时间常数）讲的是对历史观测的
   * 统计，画面应该停在「现在」不动，否则读者一边读「800 公里以上几乎一个都没动」，
   * 一边看着碎片往下掉，反而分不清哪些是观测、哪些是外推。
   */
  const ADVANCING_SCENES = new Set<string>(['decay-project']);

  function applyHorizon(years: number) {
    debris.setHorizon(horizonFor(years));
  }

  function apply(state: StepState, scene: string) {
    const next = stateFor(scene);
    currentSceneId = scene;

    // 切场景时清空用户输入：仪器表达的是「这一步的某个量」，
    // 把上一步的筛选带到下一步没有意义，而且会让画面与文案对不上。
    // 同一场景内反复 apply 不清空，否则拖动滑块会被每帧重置。
    if (scene !== sceneNow) {
      sceneNow = scene;
      clearOverride();
      catalog.setMetricRange(null, null);
      catalog.setYearMax(next.yearMax ?? null);
    }

    // 每一步内部再细分：进度 0→1 之间让镜头有轻微推进，
    // 使同一步内的滚动仍然有画面响应，不会完全静止。
    const push = 1 - Math.min(1, state.progress) * 0.055;
    rig.setPose({
      ...next.pose,
      // 用户在第四章转过转盘时，方位角以用户的为准
      azimuth: override.azimuth ?? next.pose.azimuth,
      distance: next.pose.distance * push,
      screenShift: (next.pose.screenShift ?? 0) * shiftFactor(),
    });
    rig.setSpin(next.spin);

    // ---------- 编目层 ----------
    catalog.points.visible = next.catalogVisible ?? true;
    catalog.setCategoryMix(next.categoryMix);
    catalog.setDim(next.dim);
    catalog.setOpacity(next.opacity);
    yearMax = override.year ?? next.yearMax ?? null;
    catalog.setYearMax(yearMax);

    // 强调集合变化时才重写缓冲区，避免每帧上传 15,934 条数据
    if (next.emphasize !== currentEmphasis) {
      currentEmphasis = next.emphasize;
      if (next.emphasize) {
        catalog.emphasizeCategories(next.emphasize, 0.34);
      } else {
        catalog.clearEmphasis();
      }
    }

    // ---------- 碎片层 ----------
    debris.points.visible = next.debrisVisible ?? false;
    if (next.debrisVisible) {
      debris.setOpacity(next.debrisOpacity ?? 1);
      // 用户选中了某一档近地点时以用户为准，否则用场景定义的区间
      const f = override.bin ?? next.debrisFilter;
      if (f) debris.setMetricRange(f.lo, f.hi);
      else debris.setMetricRange(null, null);
    }

    // ---------- 时间推进 ----------
    // 只有外推那一步按进度调时间；其余场景一律回到「现在」，
    // 避免往回滚时残留一个「未来」状态。
    if (override.years !== null) {
      // 用户拖过滑块，以用户的为准
      debris.setHorizon(horizonFor(override.years));
    } else if (ADVANCING_SCENES.has(scene)) {
      // 这一步内部再切成三段：50 / 100 / 200 年。
      // 用连续插值而不是跳变，是为了让「低层一个个掉下去」这个过程本身可见。
      const stops = history.projections.map((p) => p.years);
      const t = Math.min(0.9999, Math.max(0, state.progress)) * stops.length;
      const i = Math.floor(t);
      const frac = t - i;
      const from = i === 0 ? 0 : stops[i - 1];
      const to = stops[Math.min(i, stops.length - 1)];
      applyHorizon(from + (to - from) * frac);
    } else {
      applyHorizon(0);
    }

    globe.setReferenceLayersVisible(next.referenceLayers);
  }

  return {
    apply,
    applyIntent,
    get currentSceneId() {
      return currentSceneId;
    },
    get yearMax() {
      return yearMax;
    },
    get horizon() {
      return debris.horizon;
    },
    get instrument() {
      return stateFor(currentSceneId).instrument ?? null;
    },
  };
}

export { PALETTE };
