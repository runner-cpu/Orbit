// 截图体检：把 PNG 解成像素后按区域统计亮度/色彩，再画一张 ASCII 缩略图。
// 用途是替代「肉眼看截图」，终端里贴图会缩放失真，只有像素数据能确认真实渲染结果。
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8; // 跳过 PNG 签名
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('只支持 8bit PNG，实际 ' + bitDepth);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('不支持的颜色类型 ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, data: out };
}

const RAMP = ' .:-=+*#%@';

function ascii(img, cols, rows) {
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      let sum = 0, n = 0;
      const x0 = Math.floor((c * img.w) / cols), x1 = Math.floor(((c + 1) * img.w) / cols);
      const y0 = Math.floor((r * img.h) / rows), y1 = Math.floor(((r + 1) * img.h) / rows);
      for (let y = y0; y < y1; y += 2)
        for (let x = x0; x < x1; x += 2) {
          const o = (y * img.w + x) * img.channels;
          sum += 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
          n++;
        }
      const luma = n ? sum / n : 0;
      line += RAMP[Math.min(RAMP.length - 1, Math.round((luma / 255) * (RAMP.length - 1) * 2.6))];
    }
    lines.push(line);
  }
  return lines;
}

function regionStats(img, x0, y0, x1, y1) {
  let n = 0, lum = 0, maxLum = 0, bright = 0;
  let rs = 0, gs = 0, bs = 0;
  let hueCount = { cyan: 0, orange: 0, amber: 0, bluegrey: 0, other: 0 };
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = (y * img.w + x) * img.channels;
      const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++; lum += L; rs += r; gs += g; bs += b;
      if (L > maxLum) maxLum = L;
      if (L > 90) bright++;
      if (L > 26) {
        if (b > r + 18 && g > r + 6) hueCount.cyan++;
        else if (r > b + 40 && r > g + 25 && g > b) hueCount.orange++;
        else if (r > b + 30 && g > b + 10) hueCount.amber++;
        else if (b >= r && b > 30) hueCount.bluegrey++;
        else hueCount.other++;
      }
    }
  return {
    mean: +(lum / n).toFixed(2),
    max: +maxLum.toFixed(1),
    brightPct: +((100 * bright) / n).toFixed(2),
    rgb: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)],
    hue: hueCount,
  };
}

const [file, ...rest] = process.argv.slice(2);
const img = decodePng(file);
console.log(`${file}  ${img.w}x${img.h}  channels=${img.channels}`);

const overall = regionStats(img, 0, 0, img.w, img.h);
console.log('全图:', JSON.stringify(overall));

// 默认分区：左栏文字区 / 中间带 / 右侧球体区
const regions = rest.length
  ? rest.map((s) => {
      const [name, box] = s.split('=');
      const [x0, y0, x1, y1] = box.split(',').map(Number);
      return { name, x0, y0, x1, y1 };
    })
  : [
      { name: 'rail(左栏)', x0: 60, y0: 200, x1: Math.round(img.w * 0.32), y1: Math.round(img.h * 0.78) },
      { name: 'mid', x0: Math.round(img.w * 0.32), y0: 200, x1: Math.round(img.w * 0.47), y1: Math.round(img.h * 0.78) },
      { name: 'globe(右)', x0: Math.round(img.w * 0.47), y0: 200, x1: img.w - 20, y1: Math.round(img.h * 0.78) },
      { name: 'top hud', x0: 40, y0: 20, x1: img.w - 40, y1: 120 },
      { name: 'bottom hud', x0: 40, y0: Math.round(img.h * 0.88), x1: img.w - 40, y1: img.h - 20 },
    ];
for (const r of regions) {
  console.log(`  ${r.name.padEnd(12)} ${JSON.stringify(regionStats(img, r.x0, r.y0, r.x1, r.y1))}`);
}

const cols = Number(process.env.COLS || 150);
const rows = Number(process.env.ROWS || 42);
console.log('\nASCII 缩略图:');
for (const line of ascii(img, cols, rows)) console.log(line);
