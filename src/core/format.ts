/**
 * 数值格式化。
 *
 * 作品的读数区全部是真实计算结果，格式必须统一，否则同一量在不同位置
 * 出现不同写法会直接损害「数据可信」的观感。因此所有数字都走这里。
 */

/** 千分位整数：15934 → "15,934" */
export function int(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 一位小数：95.12 → "95.1"。不补零，不做四舍五入以外的修饰。 */
export function fixed(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/** 百分比：传 0–100 的数值，返回 "95.1"（不含 % 号，由调用方加） */
export function pct(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/** 按数值大小选择单位，返回 { value, unit }，避免出现 "0.3 千" 这类写法 */
export function scaled(n: number): { value: string; unit: string } {
  if (Math.abs(n) >= 1e4) return { value: (n / 1e4).toFixed(2), unit: '万' };
  return { value: int(n), unit: '' };
}

/** 把 2026-10-13T00:00:00.000Z 显示为 2026-10-13 */
export function isoDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toISOString().slice(0, 10);
}

/**
 * 把地球半径倍数换算成「视距」读数。
 * 场景中地球半径归一为 1，因此相机距离就是地球半径的倍数。
 * 显示时改用公里，因为观众对公里数有直觉，对「地球半径倍数」没有。
 */
export function cameraDistanceKm(earthRadii: number): string {
  return int(earthRadii * 6378.137);
}
