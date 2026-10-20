/**
 * 三维标注几何：高度环带与轨道面圆环。
 *
 * 与 annotations.ts 的分工：
 *   annotations 负责「文字标签贴在屏幕哪个位置」；
 *   这里负责「环画在三维空间的哪个半径、哪个倾角上」。
 *   两者共用 SceneAnnotation，因此标签与环不会各说各的。
 *
 * 为什么环必须画在三维里而不是叠一层 CSS：
 *   高度环是贴在球体上的，它要随镜头一起被球体遮住、随球体一起转动。
 *   画在屏幕空间里，环会浮在球前面，读者读不出「它在球外多远」。
 */

import * as THREE from 'three';
import { SCENE_EARTH_RADIUS } from './globe';
import type { SceneAnnotation } from './annotations';

const EARTH_RADIUS_KM = 6378.137;

export interface OverlayLayer {
  setSpecs(specs: SceneAnnotation[]): void;
  /** 每帧调用：环带做一次很慢的自转，让「这是一个球面环」可读 */
  update(dt: number): void;
  setMuted(v: boolean): void;
}

function altToRadius(altKm: number): number {
  return SCENE_EARTH_RADIUS * (1 + altKm / EARTH_RADIUS_KM);
}

/** 赤道面上的圆，作为环带的上下边缘。 */
function circlePoints(radius: number, segments = 192): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    out.push(new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
  }
  return out;
}

/** 环带面：两条同心圆之间的一圈四边形带。 */
function bandGeometry(lo: number, hi: number, segments = 192): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    const a = [Math.cos(t0) * lo, 0, Math.sin(t0) * lo];
    const b = [Math.cos(t0) * hi, 0, Math.sin(t0) * hi];
    const c = [Math.cos(t1) * hi, 0, Math.sin(t1) * hi];
    const d = [Math.cos(t1) * lo, 0, Math.sin(t1) * lo];
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

/** 倾斜轨道面：先画赤道面圆，再绕 X 轴倾斜。 */
function orbitGeometry(inclDeg: number, radius: number, segments = 256): THREE.BufferGeometry {
  const inc = (inclDeg * Math.PI) / 180;
  const positions: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    positions.push(
      Math.cos(t) * radius,
      Math.sin(t) * Math.sin(inc) * radius,
      Math.sin(t) * Math.cos(inc) * radius
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

export function createOverlayLayer(scene: THREE.Scene): OverlayLayer {
  const group = new THREE.Group();
  group.name = 'annotations';
  scene.add(group);

  let disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  let spin = 0;
  /** 只有环带需要自转，轨道面保持固定才能被读出倾角 */
  let spinTargets: THREE.Object3D[] = [];

  function clear() {
    group.clear();
    for (const d of disposables) d.dispose();
    disposables = [];
    spinTargets = [];
  }

  return {
    setSpecs(specs) {
      clear();
      for (const spec of specs) {
        const color = new THREE.Color(spec.color);

        if (spec.kind === 'band') {
          const lo = altToRadius(spec.loKm);
          const hi = altToRadius(spec.hiKm);

          // 两条边缘线：实线，明确「带」的上下界
          for (const r of [lo, hi]) {
            const geo = new THREE.BufferGeometry().setFromPoints(circlePoints(r));
            const mat = new THREE.LineBasicMaterial({
              color,
              transparent: true,
              opacity: 0.62,
              depthWrite: false,
            });
            const line = new THREE.LineLoop(geo, mat);
            line.renderOrder = 2;
            group.add(line);
            disposables.push(geo, mat);
          }

          // 带面：很低的透明度，只用来把上下界连成「一层」
          const geo = bandGeometry(lo, hi);
          const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.renderOrder = 1;
          group.add(mesh);
          disposables.push(geo, mat);
          spinTargets.push(mesh);
        } else if (spec.kind === 'orbit') {
          const r = SCENE_EARTH_RADIUS * 1.02;
          const geo = orbitGeometry(spec.inclDeg, r);
          const mat = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          });
          const line = new THREE.Line(geo, mat);
          line.renderOrder = 2;
          group.add(line);
          disposables.push(geo, mat);
        } else {
          // limb：只画一段很短的弧，标出这个高度
          const r = altToRadius(spec.altKm);
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= 48; i += 1) {
            const t = -0.5 + (i / 48) * 1.0;
            pts.push(new THREE.Vector3(Math.cos(t) * r, Math.sin(t * 0.35) * r * 0.3, Math.sin(t) * r));
          }
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          const mat = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          });
          const line = new THREE.Line(geo, mat);
          line.renderOrder = 2;
          group.add(line);
          disposables.push(geo, mat);
        }
      }
    },

    update(dt) {
      spin += dt * 0.04;
      for (const obj of spinTargets) obj.rotation.y = spin;
    },

    setMuted(v) {
      group.visible = !v;
    },
  };
}
