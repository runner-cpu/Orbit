/**
 * 第一章的场景驱动。
 *
 * 职责：把滚动步骤的状态（哪一步、这一步推进了多少）翻译成三维场景的具体参数：
 * 镜头机位、点云着色模式、类别强调、参考图层显隐、自动旋转速度。
 *
 * 为什么单独成模块、而不是写在主循环里：
 *   内容层（文案）与场景层（镜头与图层）的耦合点只有「步骤标识」这一个字符串。
 *   后续章节接入时只需新增自己的驱动模块，主循环不改。
 *
 * 设计约定：所有过渡都作用在「目标值」上，由相机与图层内部缓动。
 * 滚动只负责设定目标，不直接写当前帧的数值，因此快速滚动不会产生跳动。
 */

import type { CameraPose, CameraRig } from '../core/camera';
import { CATEGORY } from '../core/pointCloud';
import type { PointLayer } from '../core/pointCloud';
import type { Globe } from '../core/globe';
import type { StepState } from '../core/scrollStory';

interface SceneState {
  pose: CameraPose;
  /** 点云着色：0 单一色，1 按类别 */
  categoryMix: number;
  /** 非选中类别的压暗程度 */
  dim: number;
  /** 强调哪些类别；null = 全部同等 */
  emphasize: Set<number> | null;
  /** 参考图层（经纬网格、海岸线、赤道环）是否可见 */
  referenceLayers: boolean;
  /** 地球自动旋转速度（弧度/秒）。数值接近 0 时点云静止 */
  spin: number;
  /** 点云整体透明度 */
  opacity: number;
}

/**
 * 每个场景标识对应的状态。
 *
 * 镜头选择说明：
 *   视距用「地球半径倍数」表达。桌面端左侧有一条约 34ch 宽的叙事栏，
 *   因此所有机位都带 screenShift，把地球推到画面右侧，避免点云被文字压住。
 *   screenShift 的单位是视口半宽：0.28 在 1600px 宽的窗口里把球心推到
 *   约 62% 处，球体右缘留有余量，不会被裁掉。
 */
function stateFor(scene: string): SceneState {
  switch (scene) {
    case 'establish':
      return {
        pose: { azimuth: 0.62, elevation: 0.34, distance: 5.2, screenShift: 0.28 },
        categoryMix: 0,
        dim: 0,
        emphasize: null,
        referenceLayers: true,
        spin: 0.028,
        opacity: 0.95,
      };

    case 'wide':
      // 拉远：让整片近地空间成为一个整体，读数是「总量」
      return {
        pose: { azimuth: 0.95, elevation: 0.52, distance: 8.4, screenShift: 0.3 },
        categoryMix: 0,
        dim: 0,
        emphasize: null,
        referenceLayers: true,
        spin: 0.022,
        opacity: 0.9,
      };

    case 'locatable':
      // 收近并侧倾：让点云与球体的距离关系可读，突出「只画出一部分」
      return {
        pose: { azimuth: 1.35, elevation: 0.18, distance: 3.8, screenShift: 0.3 },
        categoryMix: 0.35,
        dim: 0,
        emphasize: null,
        referenceLayers: true,
        spin: 0.016,
        opacity: 0.95,
      };

    case 'band':
      // 贴近地表：把 400-600 km 这一层摊开在画面中部。
      // 这一节要看的是「薄薄一层里塞满了东西」，因此关掉网格与海岸线，
      // 只留下球体与点云，避免参照线干扰对厚度的判断。
      return {
        pose: { azimuth: 1.62, elevation: 0.1, distance: 2.9, screenShift: 0.26 },
        categoryMix: 0.8,
        dim: 0,
        emphasize: null,
        referenceLayers: false,
        spin: 0.01,
        opacity: 1,
      };

    case 'status':
      // 正侧位、视距拉近：按类别着色后，颜色分层在侧视下最清楚
      return {
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
      };

    case 'recap':
      // 回到概览机位，着色回到按类别（这一节的结论依赖类别）
      return {
        pose: { azimuth: 0.3, elevation: 0.44, distance: 6.4, screenShift: 0.3 },
        categoryMix: 1,
        dim: 0,
        emphasize: null,
        referenceLayers: true,
        spin: 0.026,
        opacity: 0.95,
      };

    default:
      return stateFor('establish');
  }
}

export interface ChapterOneScene {
  /**
   * 每个渲染帧调用。
   *
   * 为什么 scene 与 state 分开传：state.id 是「叙事步骤」标识（intro、crowding……），
   * scene 是该步骤想要的「镜头状态」标识（establish、band……）。两者不是同一个字符串，
   * 且一个镜头状态可以被多个步骤复用，因此不能在场景层按 state.id 反查。
   * 场景名由文案层在 StepCopy.scene 中声明，主循环原样转交。
   */
  apply(state: StepState, scene: string): void;
  /** 当前镜头状态标识，供读数与调试使用 */
  readonly currentSceneId: string;
}

export function createChapterOneScene(
  rig: CameraRig,
  layer: PointLayer,
  globe: Globe
): ChapterOneScene {
  let currentSceneId = 'establish';
  let currentEmphasis: Set<number> | null = null;

  // 窄屏时叙事栏移到画面底部，地球不需要再向右让位。
  // 每次 apply 时读取窗口宽度：滚动过程中窗口尺寸变化会立即生效。
  function shiftFactor(): number {
    return window.innerWidth > 1080 ? 1 : 0;
  }

  function apply(state: StepState, scene: string) {
    const next = stateFor(scene);
    currentSceneId = scene;

    // 每一步内部再细分：进度 0→1 之间让镜头有轻微推进，
    // 使同一步内的滚动仍然有画面响应，不会完全静止。
    const push = 1 - Math.min(1, state.progress) * 0.055;
    rig.setPose({
      ...next.pose,
      distance: next.pose.distance * push,
      screenShift: (next.pose.screenShift ?? 0) * shiftFactor(),
    });
    rig.setSpin(next.spin);

    layer.setCategoryMix(next.categoryMix);
    layer.setDim(next.dim);
    layer.setOpacity(next.opacity);

    // 强调集合变化时才重写缓冲区，避免每帧上传 15,934 条数据
    if (next.emphasize !== currentEmphasis) {
      currentEmphasis = next.emphasize;
      if (next.emphasize) {
        layer.emphasizeCategories(next.emphasize, 0.34);
      } else {
        layer.clearEmphasis();
      }
    }

    globe.setReferenceLayersVisible(next.referenceLayers);
  }

  return {
    apply,
    get currentSceneId() {
      return currentSceneId;
    },
  };
}
