/**
 * 轨道解算封装。
 *
 * 负责：TLE 解析 → SGP4 初始化 → 批量解算位置 → 写入预分配缓冲。
 * 与渲染完全解耦，可独立测试。基准脚本 scripts/bench-propagation.mjs 直接调用本模块。
 */
import * as satellite from 'satellite.js';

/** 地球赤道半径，用于高度换算与场景尺度归一。 */
export const EARTH_RADIUS_KM = 6378.137;

export interface TleRecord {
  name: string;
  line1: string;
  line2: string;
}

/**
 * 解析 TLE 文本。
 * 兼容带名称与不带名称两种排布，因为 CelesTrak 不同分组的输出格式略有差异。
 */
export function parseTle(text: string): TleRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0);

  const out: TleRecord[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      const prev = lines[i - 1];
      const name =
        prev && !prev.startsWith('1 ') && !prev.startsWith('2 ')
          ? prev.trim()
          : `OBJECT-${lines[i].slice(2, 7).trim()}`;
      out.push({ name, line1: lines[i], line2: lines[i + 1] });
      i += 1;
    }
  }
  return out;
}

/** 已初始化的轨道记录，复用 satrec 避免重复解析。 */
export class OrbitSet {
  private readonly satrecs: satellite.SatRec[];

  constructor(records: TleRecord[]) {
    this.satrecs = records.map((r) => satellite.twoline2satrec(r.line1, r.line2));
  }

  get size(): number {
    return this.satrecs.length;
  }

  /**
   * 在指定时刻解算全部对象，把结果写入 positions（长度 = size * 3，单位 km）。
   * 直接写入调用方提供的缓冲，避免每帧产生上万个临时对象与随之而来的 GC 停顿。
   *
   * 返回成功解算的数量；失败的对象写入 NaN，由渲染层跳过。
   */
  propagateInto(positions: Float32Array, when: Date): number {
    let ok = 0;
    for (let i = 0; i < this.satrecs.length; i += 1) {
      const pv = satellite.propagate(this.satrecs[i], when);
      const o = i * 3;
      if (pv?.position && Number.isFinite(pv.position.x)) {
        positions[o] = pv.position.x;
        positions[o + 1] = pv.position.y;
        positions[o + 2] = pv.position.z;
        ok += 1;
      } else {
        positions[o] = NaN;
        positions[o + 1] = NaN;
        positions[o + 2] = NaN;
      }
    }
    return ok;
  }
}

/** 由 TLE 第二行解算轨道要素。用于分层着色与统计，不参与每帧渲染。 */
export function elementsFromLine2(line2: string) {
  const ecc = parseFloat(`0.${line2.slice(26, 33).trim()}`);
  const inclinationDeg = parseFloat(line2.slice(8, 16));
  const nRevPerDay = parseFloat(line2.slice(52, 63));
  const n = (nRevPerDay * 2 * Math.PI) / 86400;
  const a = Math.cbrt(398600.4418 / (n * n));
  return {
    ecc,
    inclinationDeg,
    perigeeKm: a * (1 - ecc) - EARTH_RADIUS_KM,
    apogeeKm: a * (1 + ecc) - EARTH_RADIUS_KM,
    semiMajorKm: a,
  };
}
