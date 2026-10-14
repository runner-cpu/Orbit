#!/usr/bin/env node
/**
 * 把 world-atlas 的国界拓扑数据转成本作品使用的海岸线线数据集。
 *
 * 为什么需要海岸线：
 *   三维地球如果不画陆地轮廓，观众看到的是一个蓝灰色球体加一堆光点，
 *   无法判断轨道倾角、覆盖范围与地理位置的关系。加上海岸线后，
 *   「太阳同步轨道为什么覆盖全球」「静止轨道为什么都在赤道上空」这类
 *   内容才能被看出来。
 *
 * 为什么用 world-atlas：
 *   它是 Natural Earth（公有领域）的 TopoJSON 打包版，体积小、授权清晰。
 *   本脚本把它展开为纯坐标数组，运行期不需要 topojson 解码库。
 *
 * 用法：node scripts/build-coastlines.mjs
 * 产出：public/data/coastlines.json  线段数组，每段为 [经度, 纬度] 列表
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { feature, mesh } = require('topojson-client');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public', 'data');

// 1:110m 精度：全球海岸线约 2,800 个点，38 KB 左右。
// 再高一档（50m）会到 300 KB 以上，在这个球体尺寸下看不出差别。
const SOURCE = path.join(ROOT, 'node_modules', 'world-atlas', 'countries-110m.json');

/** 保留两位小数。在 1:110m 精度下这已经是原始数据的全部有效位数。 */
function round(coord) {
  return [+coord[0].toFixed(2), +coord[1].toFixed(2)];
}

async function main() {
  const topo = JSON.parse(await readFile(SOURCE, 'utf8'));

  // mesh + 过滤函数 (a !== b)：只取国家之间的外部边界，也就是海岸线。
  // 这样得到的是开放折线，不需要处理多边形闭合与填洞。
  const boundary = mesh(topo, topo.objects.countries, (a, b) => a !== b);

  const lines = boundary.coordinates.map((line) => line.map(round));

  // 同时保留陆地多边形，供需要填充材质时使用（当前版本只画线，留作备用）
  const land = feature(topo, topo.objects.countries).features.length;

  const payload = {
    source: 'Natural Earth 1:110m（经 world-atlas 打包，公有领域）',
    sourceUrl: 'https://github.com/nvkelso/natural-earth-vector',
    license: 'Public Domain',
    precision: '1:110m',
    boundaryCount: lines.length,
    countryCount: land,
    unit: 'degrees',
    order: 'lon,lat',
    lines,
  };

  await mkdir(OUT, { recursive: true });
  const file = path.join(OUT, 'coastlines.json');
  const text = JSON.stringify(payload);
  await writeFile(file, text, 'utf8');

  const points = lines.reduce((n, l) => n + l.length, 0);
  console.log('=== 海岸线数据集 ===');
  console.log(`  折线段数      ${lines.length}`);
  console.log(`  坐标点数      ${points.toLocaleString()}`);
  console.log(`  国家/地区数   ${land}`);
  console.log(`  文件体积      ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
  console.log('\n已写入 public/data/coastlines.json');
}

main().catch((e) => {
  console.error('失败:', e.message || e);
  process.exit(1);
});
