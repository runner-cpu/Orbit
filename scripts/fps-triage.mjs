// 帧率归因实验：主线程空闲（setInterval 50ms 准点）但 rAF 只有 1Hz，
// 说明瓶颈不在 JS，而在这页特有的某个绘制/合成环节。逐项摘除后测量。
export async function run(page) {
  const measure = async (label, ms = 6000) => {
    const r = await page.evaluate(async (ms) => {
      const t0 = performance.now();
      let n = 0;
      await new Promise((res) => {
        const s = () => { n++; performance.now() - t0 > ms ? res() : requestAnimationFrame(s); };
        requestAnimationFrame(s);
      });
      return { fps: +(n / ((performance.now() - t0) / 1000)).toFixed(2), frames: n };
    }, ms);
    return [label, r.fps, r.frames];
  };

  const rows = [];
  await page.goto('http://127.0.0.1:4173/?qa=1');
  await page.waitForTimeout(3000);
  rows.push(await measure('1 baseline'));

  rows.push(await measure('2 canvas removed from DOM', 6000));
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    c.__parent = c.parentNode;
    c.remove();
  });
  rows.push(await measure('   (after remove)'));
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (c && c.__parent) c.__parent.appendChild(c);
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    document.querySelectorAll('.hud').forEach((e) => (e.style.display = 'none'));
    const v = document.querySelector('.scene-vignette');
    if (v) v.style.display = 'none';
  });
  rows.push(await measure('3 no hud + no vignette'));
  await page.evaluate(() => {
    document.querySelectorAll('.hud').forEach((e) => (e.style.display = ''));
    const v = document.querySelector('.scene-vignette');
    if (v) v.style.display = '';
  });

  await page.evaluate(() => {
    document.querySelector('main').style.display = 'none';
    document.querySelectorAll('.methods').forEach((e) => (e.style.display = 'none'));
  });
  rows.push(await measure('4 no story DOM'));
  await page.evaluate(() => {
    document.querySelector('main').style.display = '';
    document.querySelectorAll('.methods').forEach((e) => (e.style.display = ''));
  });

  rows.push(await measure('5 back to baseline'));
  return rows.map((r) => r.join('  ')).join('\n');
}
