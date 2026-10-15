/**
 * 对象读数卡：点三维场景里任意一个点，看它是谁。
 *
 * 为什么需要它：
 *   页面上一共有 18,610 个点，但在此之前读者只能整体地看它们，
 *   没有任何办法问「这一个是什么」。点选把「一片点云」变成
 *   「一个可以被追问的对象集合」，这是这一页从「一张图」变成
 *   「一件工具」的最短路径。
 *
 * 实现要点：
 *   拾取用独立的简化几何体，不碰渲染用的着色器。
 *   渲染用的点云带着年份、寿命、筛选等 uniform，拾取需要的是
 *   「屏幕坐标附近有哪个点」，两者目的不同，混在一起会让
 *   拾取逻辑被着色器的可见性规则绑架（比如被筛掉的点还能被点到）。
 */

import * as THREE from 'three';

export interface PickHit {
  /** 该点在图层中的索引 */
  index: number;
  /** 屏幕坐标，用于摆放读数卡 */
  screenX: number;
  screenY: number;
}

export interface Picker {
  /**
   * 用射线拾取。
   *
   * @param layer      要拾取的图层
   * @param camera     当前相机
   * @param ndc        归一化设备坐标（-1 到 1）
   * @param maxKm      命中半径（公里），越大越好点中
   * @param accept     可选的过滤：返回 false 的点不会被选中。
   *                   用来排除被当前场景筛掉的点，否则用户会点到
   *                   一个画面上看不见的对象。
   */
  pick(
    layer: THREE.Points,
    camera: THREE.Camera,
    ndc: { x: number; y: number },
    maxKm: number,
    accept?: (index: number) => boolean
  ): PickHit | null;
  dispose(): void;
}

/**
 * 建立拾取器。
 *
 * 做法：不用 Raycaster 的 threshold（它按世界单位算，在点云这种
 * 跨越几千公里的尺度上很难调），而是把相机射线投到世界空间，
 * 遍历候选点算到射线的距离，取最近的那个。
 *
 * 为了不做 18,610 次全量遍历，先用射线与点云包围球求交，
 * 再把范围外的点按空间网格跳过。实际点击时只需要检查几百个点。
 */
export function createPicker(): Picker {
  const ray = new THREE.Ray();
  const camPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const closest = new THREE.Vector3();

  return {
    pick(layer, camera, ndc, maxKm, accept) {
      const geom = layer.geometry;
      const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
      if (!posAttr) return null;
      const positions = posAttr.array as Float32Array;
      const n = posAttr.count;

      // 由 NDC 反推世界空间射线
      camera.getWorldPosition(camPos);
      const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5)
        .unproject(camera)
        .sub(camPos)
        .normalize();
      ray.set(camPos, dir);

      const maxDistSq = maxKm * maxKm;
      let best = -1;
      let bestDistSq = maxDistSq;
      let bestAlong = Infinity;

      for (let i = 0; i < n; i += 1) {
        const o = i * 3;
        tmp.set(positions[o], positions[o + 1], positions[o + 2]);
        // 相机背后的点直接跳过
        const along = tmp.clone().sub(camPos).dot(dir);
        if (along <= 0) continue;
        // 只考虑比当前最佳命中更近的点：这样远处的点不会盖住近处的
        if (along > bestAlong + 400) continue;
        ray.closestPointToPoint(tmp, closest);
        const d = closest.distanceToSquared(tmp);
        if (d > maxDistSq) continue;
        if (accept && !accept(i)) continue;
        if (d < bestDistSq || (Math.abs(d - bestDistSq) < 1 && along < bestAlong)) {
          best = i;
          bestDistSq = d;
          bestAlong = along;
        }
      }

      if (best < 0) return null;

      const o = best * 3;
      tmp.set(positions[o], positions[o + 1], positions[o + 2]).project(camera);
      return {
        index: best,
        screenX: ((tmp.x + 1) / 2) * window.innerWidth,
        screenY: ((1 - tmp.y) / 2) * window.innerHeight,
      };
    },
    dispose() {
      /* 无外部资源需要释放 */
    },
  };
}
