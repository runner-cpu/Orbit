// 沿水平/垂直扫描线打印亮度剖面。深空主题整体都在 luma<30 的暗区，
// 缩略图看不出结构，只有剖面能确认「球面边缘 / 网格 / 点云」这三层是否真的分离。
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8, w = 0, h = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x], c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, data: out };
}

const img = decodePng(process.argv[2]);
const px = (x, y) => { const o = (y * img.w + x) * img.channels; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
const lum = (x, y) => { const [r, g, b] = px(x, y); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

const mode = process.argv[3] || 'scan';
const y0 = Number(process.argv[4] || Math.round(img.h / 2));
const x0 = Number(process.argv[5] || Math.round(img.w / 2));

if (mode === 'scan') {
  const step = 8;
  console.log(`--- 水平扫描线 y=${y0} (每 ${step}px 采样, 值=luma 0-255) ---`);
  let line = '', labels = '';
  for (let x = 0; x < img.w; x += step) {
    const L = lum(x, y0);
    line += L > 200 ? '#' : L > 120 ? 'O' : L > 60 ? 'o' : L > 32 ? '+' : L > 18 ? ':' : L > 10 ? '.' : ' ';
  }
  console.log(line);
  for (let x = 0; x < img.w; x += step * 10) labels += String(x).padEnd(step * 10);
  console.log(labels);
  const samples = [];
  for (let x = 0; x < img.w; x += 40) samples.push(`${x}:${Math.round(lum(x, y0))}`);
  console.log(samples.join(' '));
}

if (mode === 'vscan') {
  const step = 8;
  console.log(`--- 垂直扫描线 x=${x0} (每 ${step}px 采样) ---`);
  let line = '';
  for (let y = 0; y < img.h; y += step) {
    const L = lum(x0, y);
    line += L > 200 ? '#' : L > 120 ? 'O' : L > 60 ? 'o' : L > 32 ? '+' : L > 18 ? ':' : L > 10 ? '.' : ' ';
  }
  console.log(line);
}

if (mode === 'popcount') {
  // 统计球体带状区域里「孤立亮点」（点云）与「连续亮线」（网格/海岸线）的数量
  const yFrom = Number(process.argv[4]), yTo = Number(process.argv[5]);
  const xFrom = Number(process.argv[6]), xTo = Number(process.argv[7]);
  let isolated = 0, runs = 0, runPix = 0, lit = 0;
  for (let y = yFrom; y < yTo; y += 2) {
    let inRun = 0;
    for (let x = xFrom; x < xTo; x++) {
      const L = lum(x, y);
      if (L > 26) { lit++; inRun++; }
      else { if (inRun === 1) isolated++; else if (inRun > 1) { runs++; runPix += inRun; } inRun = 0; }
    }
    if (inRun === 1) isolated++; else if (inRun > 1) { runs++; runPix += inRun; }
  }
  console.log(`区 ${xFrom}-${xTo} x ${yFrom}-${yTo}: 亮像素=${lit} 孤立点=${isolated} 连续段=${runs} 段内像素=${runPix} 平均段长=${runs ? (runPix / runs).toFixed(1) : 0}`);
}

if (mode === 'strip') {
  console.log('右边缘竖向色带 (x=1590..1599):');
  for (const y of [4, 40, 100, 200, 300, 400, 500, 600, 700, 800, 900, 960, 996]) {
    const row = [];
    for (let x = 1588; x < 1600; x += 3) row.push(`${x}:${px(x, y).join(',')}`);
    console.log(`  y=${String(y).padStart(3)} ${row.join('  ')}`);
  }
}
