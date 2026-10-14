// 逐节截图：把每一步滚到「阅读位置」而不是「刚进入位置」再截。
// goTo 只把该步的判定线对齐到视口中部，此时文字还在屏幕下半，
// 直接截会在画面上半留下大片空白，不能代表评委真正看到的画面。
export async function captureAll(p, { prefix, extraScroll = 0.45, settle = 2600, steps }) {
  const rows = [];
  for (const id of steps) {
    await p.evaluate((id) => window.__orbit.goTo(id), id);
    await p.waitForTimeout(settle);
    await p.evaluate((k) => window.scrollBy(0, window.innerHeight * k), extraScroll);
    await p.waitForTimeout(1200);
    const st = await p.evaluate(() => window.__orbit.stats());
    await p.screenshot({ path: `${prefix}${id}.png` });
    rows.push(
      `${id.padEnd(14)} scene=${String(st.scene).padEnd(10)} dist=${String(st.cameraDistanceEarthRadii).padEnd(6)} prog=${st.stepProgress} fps=${st.fps}`
    );
  }
  return rows.join('\n');
}
