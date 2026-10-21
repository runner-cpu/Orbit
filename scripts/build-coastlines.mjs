#!/usr/bin/env node
/**
 * 把 world-atlas 的陆地拓扑数据转成本作品使用的地理轮廓线数据集。
 *
 * 为什么需要海岸线：
 *   三维地球如果不画陆地轮廓，观众看到的是一个蓝灰色球体加一堆光点，
 *   无法判断轨道倾角、覆盖范围与地理位置的关系。加上海岸线后，
 *   「太阳同步轨道为什么覆盖全球」「静止轨道为什么都在赤道上空」这类
 *   内容才能被看出来。
 *
 * 为什么从 countries 换成 land：
 *   旧版用 countries-110m 的 mesh(a !== b)，只保留国家之间的外部边界。
 *   这个过滤会把「整座岛都属于同一个国家」的海岸线一并丢掉——菲律宾、
 *   日本、英国、新西兰在球面上直接消失，南海一带出现一大块空白。
 *   改用 land-50m 的完整陆地边界后，所有岛屿轮廓都会保留。
 *
 * 为什么还要简化：
 *   land-50m 原始边界有 6 万个点、约 880 KB，对 1 个地球半径的球体来说
 *   远超屏幕能分辨的精度。用 Douglas-Peucker 以 0.1°（约 11 km）为容差
 *   抽稀后仍有 1.4 万个点，岛屿一个不少，体积降到约 200 KB。
 *
 * 用法：node scripts/build-coastlines.mjs
 * 产出：public/data/coastlines.json  线段数组，每段为 [经度, 纬度] 列表
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mesh } = require('topojson-client');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public', 'data');

const SOURCE = path.join(ROOT, 'node_modules', 'world-atlas', 'land-50m.json');

/** 抽稀容差（度）。0.1° 约为 11 km，在球体尺寸下已看不出折线。 */
const SIMPLIFY_DEG = 0.1;

/** 保留两位小数。抽稀后这已是原始数据的全部有效位数。 */
function round(coord) {
  return [+coord[0].toFixed(2), +coord[1].toFixed(2)];
}

/**
 * Douglas-Peucker 折线抽稀。
 *
 * 只做平面近似：经纬度在极区会被拉伸，但本数据集里高纬度海岸线（格陵兰、
 * 北极群岛）本身点就少，0.1° 的容差不会造成可见误差。
 */
function simplify(points, eps) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const sq = eps * eps;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1;
    let idx = -1;
    const [x1, y1] = points[a];
    const [x2, y2] = points[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i += 1) {
      const [x, y] = points[i];
      let d;
      if (len2 === 0) {
        d = (x - x1) ** 2 + (y - y1) ** 2;
      } else {
        let t = ((x - x1) * dx + (y - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        d = (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2;
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > sq) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

async function main() {
  const topo = JSON.parse(await readFile(SOURCE, 'utf8'));

  // 完整陆地边界：不做 a !== b 过滤，岛屿轮廓因此不会被误删。
  const boundary = mesh(topo, topo.objects.land);

  const lines = boundary.coordinates
    .map((line) => simplify(line, SIMPLIFY_DEG).map(round))
    .filter((line) => line.length >= 3);

  const points = lines.reduce((n, l) => n + l.length, 0);

  const payload = {
    source: 'Natural Earth 1:50m（经 world-atlas 打包，公有领域）',
    sourceUrl: 'https://github.com/nvkelso/natural-earth-vector',
    license: 'Public Domain',
    precision: '1:50m',
    simplify: `${SIMPLIFY_DEG}°`,
    boundaryCount: lines.length,
    unit: 'degrees',
    order: 'lon,lat',
    lines,
  };

  await mkdir(OUT, { recursive: true });
  const file = path.join(OUT, 'coastlines.json');
  const text = JSON.stringify(payload);
  await writeFile(file, text, 'utf8');

  console.log('=== 海岸线数据集 ===');
  console.log(`  数据源        land-50m`);
  console.log(`  抽稀容差      ${SIMPLIFY_DEG}°`);
  console.log(`  折线段数      ${lines.length}`);
  console.log(`  坐标点数      ${points.toLocaleString()}`);
  console.log(`  文件体积      ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
  console.log('\n已写入 public/data/coastlines.json');
}

main().catch((e) => {
  console.error('失败:', e.message || e);
  process.exit(1);
});
