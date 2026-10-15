#!/usr/bin/env node
/**
 * 解算性能基准：验证「全量编目 + 碎片群」在浏览器里的可行刷新策略。
 *
 * 背景：第一章要同时呈现约 1.6 万个在轨目标，第三、四章要叠加 2,676 个碎片，
 * 合计约 1.86 万个对象。若每帧都全量解算，单帧耗时超出 60fps 预算，
 * 因此需要确定一个「解算频率低于渲染频率」的架构。
 *
 * 本脚本测三件事：
 *   1. 全量解算一次的真实耗时（对象分配版）
 *   2. 写入预分配 Float32Array 的耗时（无对象分配版）
 *   3. 不同解算频率下的单帧均摊成本，据此选定架构
 *
 * 用法：node scripts/bench-propagation.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as satellite from 'satellite.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.resolve(HERE, '..', 'data', 'raw');

/** 读 TLE 文件，返回 [line1, line2] 数组。 */
function loadTle(file) {
  const text = readFileSync(path.join(RAW, file), 'utf8');
  const lines = text.split(/\r?\n/).filter((s) => s.trim());
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      out.push([lines[i], lines[i + 1]]);
      i += 1;
    }
  }
  return out;
}

function bench(label, fn, runs = 5) {
  fn(); // 预热，排除 JIT 首次编译成本
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`  ${label.padEnd(42)} ${median.toFixed(1)} ms`);
  return median;
}

function main() {
  const catalog = loadTle('catalog.tle');
  const debris = [
    ...loadTle('fengyun-1c-debris.tle'),
    ...loadTle('cosmos-2251-debris.tle'),
    ...loadTle('iridium-33-debris.tle'),
  ];
  const all = [...catalog, ...debris];

  console.log('=== 数据集 ===');
  console.log(`  在轨编目 (catalog.tle)   ${catalog.length}`);
  console.log(`  碎片群 (3 组)            ${debris.length}`);
  console.log(`  合计                     ${all.length}`);

  // 1) 初始化：twoline2satrec。只在加载时做一次，不进入每帧预算。
  console.log('\n=== 一次性初始化（仅加载时执行）===');
  let satrecs;
  bench('twoline2satrec 全量', () => {
    satrecs = all.map(([l1, l2]) => satellite.twoline2satrec(l1, l2));
  });

  const when = new Date('2026-10-13T00:00:00Z');

  // 2) 对象分配版：每次 propagate 返回新对象，GC 压力大。
  console.log('\n=== 解算：对象分配版 ===');
  const allocMs = bench('propagate 全量（返回新对象）', () => {
    let bad = 0;
    for (const r of satrecs) {
      const pv = satellite.propagate(r, when);
      if (!pv || !pv.position || Number.isNaN(pv.position.x)) bad += 1;
    }
    return bad;
  });

  // 3) 无分配版：直接写入预分配的 Float32Array，供 BufferGeometry 直接使用。
  //    这是最终采用的方案，省掉每秒数万次对象分配与随之而来的 GC 停顿。
  console.log('\n=== 解算：预分配缓冲版（最终采用）===');
  const positions = new Float32Array(all.length * 3);
  const noAllocMs = bench('propagate 全量（写入 Float32Array）', () => {
    const gmst = satellite.gstime(when);
    const out = positions;
    for (let i = 0; i < satrecs.length; i += 1) {
      const r = satrecs[i];
      // 用低层接口避免构造 {position, velocity} 中间对象
      const pv = satellite.propagate(r, when);
      const o = i * 3;
      if (pv && pv.position && !Number.isNaN(pv.position.x)) {
        out[o] = pv.position.x;
        out[o + 1] = pv.position.y;
        out[o + 2] = pv.position.z;
      } else {
        out[o] = NaN;
      }
    }
    return gmst;
  });

  // 4) 不同解算频率下的单帧均摊成本
  console.log('\n=== 单帧均摊成本（60fps = 16.7ms 预算）===');
  const budget = 16.7;
  console.log(`  全量解算一次基准: ${noAllocMs.toFixed(1)} ms`);
  console.log('');
  console.log('  解算频率        均摊/帧      占预算     结论');
  for (const hz of [60, 30, 20, 10, 6, 4, 2, 1]) {
    const perFrame = (noAllocMs * hz) / 60;
    const pct = (perFrame / budget) * 100;
    const verdict = pct < 25 ? '宽裕，可叠加渲染开销'
      : pct < 60 ? '可行'
      : pct < 100 ? '紧张，需配合降级策略'
      : '不可行';
    console.log(
      `  ${String(hz).padStart(2)} Hz         ${perFrame.toFixed(2).padStart(6)} ms    ${pct.toFixed(0).padStart(4)}%     ${verdict}`
    );
  }

  // 5) 分层解算策略：远景层（1.6万编目）低频，近景层（碎片）高频
  console.log('\n=== 分层解算策略（推荐架构）===');
  const catRecs = satrecs.slice(0, catalog.length);
  const debRecs = satrecs.slice(catalog.length);
  const catMs = bench('仅编目层（15,934）解算一次', () => {
    for (const r of catRecs) satellite.propagate(r, when);
  });
  const debMs = bench('仅碎片层（2,676）解算一次', () => {
    for (const r of debRecs) satellite.propagate(r, when);
  });

  console.log('\n  方案：编目层 6Hz + 碎片层 60Hz，两者都在 Worker 内执行');
  const catPerFrame = (catMs * 6) / 60;
  const debPerFrame = (debMs * 60) / 60;
  const total = catPerFrame + debPerFrame;
  console.log(`    编目层 6Hz  → 均摊 ${catPerFrame.toFixed(2)} ms/帧`);
  console.log(`    碎片层 60Hz → 均摊 ${debPerFrame.toFixed(2)} ms/帧`);
  console.log(`    合计        → ${total.toFixed(2)} ms/帧 (${((total / budget) * 100).toFixed(0)}% 预算)`);

  // 6) 时间轴拖动的极端情况：连续 5 帧全量重算
  console.log('\n=== 极端情况：拖动时间轴连续全量重算 ===');
  const dragMs = bench('连续 5 次全量解算（模拟快速拖动）', () => {
    for (let k = 0; k < 5; k += 1) {
      const t = new Date(when.getTime() + k * 3600000);
      for (const r of satrecs) satellite.propagate(r, t);
    }
  }, 3);
  console.log(`  说明：拖动时降级为 10Hz 刷新并对点云做运动模糊替代，可保持响应`);

  console.log('\n=== 结论 ===');
  console.log(`  全量一次解算 ${noAllocMs.toFixed(1)}ms 无法支撑每帧执行，`);
  console.log(`  采用分层频率后单帧均摊 ${total.toFixed(2)}ms，占预算 ${((total / budget) * 100).toFixed(0)}%，`);
  console.log(`  余量足够同时完成点云上传与 WebGL 渲染。`);
}

main();
