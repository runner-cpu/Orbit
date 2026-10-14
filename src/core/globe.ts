import * as THREE from 'three';

/** 场景尺度：地球半径归一为 1，所有距离按此换算。 */
export const SCENE_EARTH_RADIUS = 1;

/** 地球赤道半径（km），用于把 ECEF 坐标换算到场景尺度。 */
const EARTH_RADIUS_KM = 6378.137;

/** 经度/纬度（度）→ 场景坐标。用于海岸线与经纬网格。 */
export function lonLatToScene(lonDeg: number, latDeg: number, radius = SCENE_EARTH_RADIUS): THREE.Vector3 {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const cl = Math.cos(lat);
  // ECEF: X 指向本初子午线与赤道交点，Y 指向东经 90°，Z 指向北极
  // three（Y 轴朝上）: X = ecefX, Y = ecefZ, Z = -ecefY
  return new THREE.Vector3(
    cl * Math.cos(lon) * radius,
    Math.sin(lat) * radius,
    -cl * Math.sin(lon) * radius
  );
}

/** 地固坐标（km）→ 场景坐标。点云与地球使用同一套换算。 */
export function ecefKmToScene(x: number, y: number, z: number): THREE.Vector3 {
  const s = SCENE_EARTH_RADIUS / EARTH_RADIUS_KM;
  return new THREE.Vector3(x * s, z * s, -y * s);
}

interface CoastlinePayload {
  source: string;
  boundaryCount: number;
  lines: number[][][];
}

/**
 * 地球本体与地理参考层。
 *
 * 不使用贴图：作品全程离线运行，贴图会显著增加体积并引入第三方素材授权问题。
 * 改为「深色球体 + 海岸线 + 经纬网格 + 赤道环」的线框表达，这既贴合数据仪器的
 * 观感，也避免引入任何需要署名授权的图像资源。
 */
export interface Globe {
  group: THREE.Group;
  /** 随地球一起自转的层（海岸线、经纬网格、赤道环） */
  spins: THREE.Group;
  /** 不随地球自转的层（大气辉光） */
  static: THREE.Group;
  /** 载入海岸线数据，返回折线段数 */
  loadCoastlines(url: string): Promise<number>;
  /** 交互式地层显隐 */
  setReferenceLayersVisible(v: boolean): void;
}

export function createGlobe(scene: THREE.Scene): Globe {
  const group = new THREE.Group();
  const spins = new THREE.Group();
  const statics = new THREE.Group();

  // ---------- 地球本体 ----------
  // 极深的冷蓝，几乎吸光，让点云成为唯一的高亮信息层。
  // 球体本身不发光：若加了自发光，点云与球体会连成一片，
  // 「点在地球之外」这个关键的空间关系就读不出来了。
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(SCENE_EARTH_RADIUS, 96, 64),
    new THREE.MeshStandardMaterial({ color: 0x050d15, roughness: 0.96, metalness: 0.0 })
  );
  spins.add(body);

  // ---------- 经纬网格 ----------
  // 每 15° 一条。用于读出轨道倾角、判断空间方位，也是「仪器感」的主要来源。
  //
  // 合并成单个 LineSegments：若每条线各建一个 Line 对象，光是网格就有 35 次
  // draw call，加上点云与地球本体，首帧开销被无谓地拉高。合并后网格只占一次。
  const graticulePositions: number[] = [];
  const pushLine = (pts: THREE.Vector3[]) => {
    for (let i = 0; i < pts.length - 1; i += 1) {
      graticulePositions.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    }
  };

  // 网格色：比海岸线更暗一档，保证海岸线始终是地理参照层里最清楚的一条
  const GRID_COLOR = 0x1d3d55;

  // 经线：每 15° 一条半圆
  for (let lon = -180; lon < 180; lon += 15) {
    const pts: THREE.Vector3[] = [];
    for (let lat = -90; lat <= 90; lat += 3) {
      pts.push(lonLatToScene(lon, lat, SCENE_EARTH_RADIUS * 1.0006));
    }
    pushLine(pts);
  }
  // 纬线：每 15° 一条整圆
  for (let lat = -75; lat <= 75; lat += 15) {
    const pts: THREE.Vector3[] = [];
    for (let lon = -180; lon <= 180; lon += 3) {
      pts.push(lonLatToScene(lon, lat, SCENE_EARTH_RADIUS * 1.0006));
    }
    pushLine(pts);
  }

  const graticuleGeo = new THREE.BufferGeometry();
  graticuleGeo.setAttribute('position', new THREE.Float32BufferAttribute(graticulePositions, 3));
  const graticule = new THREE.LineSegments(
    graticuleGeo,
    // 网格只作方位参照，压到刚好可见：贴近地表观察时，过亮的网格会和点云
    // 混成一片噪点，反而看不清点本身。
    new THREE.LineBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.3 })
  );
  spins.add(graticule);

  // ---------- 赤道参考环 ----------
  // 比赤道纬线更亮：轨道倾角都以它为基准读数。
  const equatorPts: THREE.Vector3[] = [];
  for (let lon = -180; lon <= 180; lon += 1.5) {
    equatorPts.push(lonLatToScene(lon, 0, SCENE_EARTH_RADIUS * 1.0015));
  }
  const equator = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(equatorPts),
    new THREE.LineBasicMaterial({ color: 0x4a90b8, transparent: true, opacity: 0.8 })
  );
  spins.add(equator);

  // ---------- 海岸线 ----------
  const coastGroup = new THREE.Group();
  coastGroup.name = 'coastlines';
  spins.add(coastGroup);

  // ---------- 大气辉光 ----------
  // 背面渲染的半透明壳。成本远低于后处理，且不需要额外的渲染通道。
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(SCENE_EARTH_RADIUS * 1.045, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x3d8fc4,
      transparent: true,
      opacity: 0.085,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );

  // 边缘辉光：把地球轮廓从深空背景里衬出来，避免球体边缘糊成一团黑。
  const limb = new THREE.Mesh(
    new THREE.SphereGeometry(SCENE_EARTH_RADIUS * 1.002, 96, 64),
    new THREE.MeshBasicMaterial({
      color: 0x2b6f9c,
      transparent: true,
      opacity: 0.16,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  statics.add(atmosphere, limb);

  // 光照：一盏方向光当太阳，一盏弱环境光保证夜面仍可读出海岸线。
  const sun = new THREE.DirectionalLight(0xdceaf5, 1.5);
  sun.position.set(6, 2.4, 4);
  const ambient = new THREE.AmbientLight(0x24425c, 1.1);

  group.add(spins, statics);
  scene.add(group, sun, ambient);

  async function loadCoastlines(url: string): Promise<number> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`海岸线数据加载失败：HTTP ${res.status}`);
    const payload = (await res.json()) as CoastlinePayload;

    const positions: number[] = [];
    for (const line of payload.lines) {
      // 折线转成两两相连的线段：LineSegments 比多条 Line 少 158 次 draw call
      for (let i = 0; i < line.length - 1; i += 1) {
        const a = lonLatToScene(line[i][0], line[i][1], SCENE_EARTH_RADIUS * 1.0016);
        const b = lonLatToScene(line[i + 1][0], line[i + 1][1], SCENE_EARTH_RADIUS * 1.0016);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x6fb0d4,
      transparent: true,
      opacity: 0.5,
    });
    coastGroup.add(new THREE.LineSegments(geo, mat));
    return payload.boundaryCount;
  }

  function setReferenceLayersVisible(v: boolean): void {
    graticule.visible = v;
    equator.visible = v;
    coastGroup.visible = v;
  }

  return { group, spins, static: statics, loadCoastlines, setReferenceLayersVisible };
}
