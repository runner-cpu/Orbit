/**
 * 每一步挂在球上的标注。
 *
 * 这份表是「左栏一句话」之外的第二层表达：左栏说结论，球上指出结论对应的
 * 那一圈、那一面、那一层。两处使用同一批数字（都从 Figures 取），
 * 因此不会出现「文字说 11,783、环上标 12,000」这种错位。
 *
 * 命名约定：
 *   scene 键与 chapters/scenes.ts 的场景标识一致。场景切换时按它查表。
 *   返回空数组表示这一步不加标注（例如开场与收尾，画面本身已经足够）。
 */

import { int, fixed } from '../core/format';
import type { Figures } from '../content/figures';
import type { SceneAnnotation } from '../core/annotations';
import { DEBRIS_PALETTE } from './scenes';

/** 取某一高度层的计数，找不到时返回 0。 */
function bandCount(f: Figures, label: string): number {
  return f.bands.find((b) => b.label === label)?.count ?? 0;
}

/** 某一年的在轨编目总量。 */
function inOrbitAt(f: Figures, year: number): number {
  const s = f.historySeries.find((x) => x.year === year);
  return s ? s.inOrbit : 0;
}

/** 近地轨道主带：400-600 公里。第一章到第二章反复回到这一层。 */
function leoBand(f: Figures, title = '400-600 km'): SceneAnnotation {
  return {
    kind: 'band',
    loKm: 400,
    hiKm: 600,
    color: 0x4fc3f7,
    title,
    value: `${int(bandCount(f, '400-600 km'))} 个`,
    side: 1,
  };
}

export function buildAnnotations(f: Figures): Record<string, SceneAnnotation[]> {
  const fy = f.debris.find((d) => d.key === 'fengyun1c');
  const cosmos = f.debris.find((d) => d.key === 'cosmos2251');
  const iridium = f.debris.find((d) => d.key === 'iridium33');

  const fengyunShell: SceneAnnotation | null = fy
    ? {
        kind: 'band',
        loKm: 750,
        hiKm: 850,
        color: DEBRIS_PALETTE.fengyun1c,
        title: '风云一号C 碎片壳',
        value: `${int(fy.count)} 个 · 中位 ${fixed(fy.perigeeMedianKm)} km`,
        side: 1,
      }
    : null;

  const shells: SceneAnnotation[] = fengyunShell ? [fengyunShell] : [];

  return {
    // ---------- 第一章 ----------
    establish: [
      {
        kind: 'limb',
        altKm: 400,
        color: 0x7ad4f5,
        title: '近地轨道',
        value: `${int(f.located)} 个可定位物体`,
        side: 1,
      },
    ],
    wide: [
      {
        kind: 'limb',
        altKm: 2000,
        color: 0x4fc3f7,
        title: '2,000 km',
        value: '九成半在这里面',
        side: 1,
      },
    ],
    locatable: [
      {
        kind: 'band',
        loKm: 400,
        hiKm: 600,
        color: 0x4fc3f7,
        title: '画得出的那一批',
        value: `${int(f.located)} 个 / 编目 ${int(f.cataloguedInOrbit)} 个`,
        side: 1,
      },
    ],
    band: [leoBand(f, '400-600 km · 最挤的一层')],
    status: [
      {
        kind: 'band',
        loKm: 400,
        hiKm: 600,
        color: 0x7ad4f5,
        title: '仍在工作的载荷',
        value: `${int(f.workingPayloads)} 个 · 不到在轨的一半`,
        side: 1,
      },
    ],

    // ---------- 第二章 ----------
    'growth-early': [
      {
        kind: 'band',
        loKm: 400,
        hiKm: 600,
        color: 0x4fc3f7,
        title: '1965 年末',
        value: (c) => `${int(inOrbitAt(f, c.yearMax ?? 1965))} 个在轨`,
        side: 1,
      },
    ],
    'growth-payload': [
      {
        kind: 'band',
        loKm: 400,
        hiKm: 600,
        color: 0x4fc3f7,
        title: '1980 年末',
        value: (c) => `${int(inOrbitAt(f, c.yearMax ?? 1980))} 个在轨`,
        side: 1,
      },
    ],
    'growth-fragmentation': [
      {
        kind: 'limb',
        altKm: 800,
        color: 0xff6b35,
        title: '碎片与残骸',
        value: `${int(f.breakdown.find((b) => b.key === 'debris')?.count ?? 0)} 个碎片`,
        side: 1,
      },
    ],
    'growth-constellation': [
      {
        kind: 'band',
        loKm: 500,
        hiKm: 600,
        color: 0x7ad4f5,
        title: '星座主带',
        value: '2020 年以后的主要增量',
        side: 1,
      },
    ],
    'growth-now': [
      {
        kind: 'band',
        loKm: 400,
        hiKm: 600,
        color: 0x4fc3f7,
        title: (c) => `${c.yearMax ?? f.historyLastYear} 年末`,
        value: (c) => `${int(inOrbitAt(f, c.yearMax ?? f.historyLastYear))} 个在轨`,
        side: 1,
      },
    ],

    // ---------- 第三章 ----------
    'fy-arrive': [
      ...shells,
      {
        kind: 'limb',
        altKm: 865,
        color: 0xffd54f,
        title: '撞击高度 865 km',
        value: '动能拦截',
        side: -1,
      },
    ],
    'fy-shell': shells,
    'fy-band': [
      ...shells,
      {
        kind: 'limb',
        altKm: 800,
        color: 0xff6b35,
        title: '800 km',
        value: '大气清除的边缘',
        side: -1,
      },
    ],
    'fy-edge': shells,

    // ---------- 第四章 ----------
    'impact-dual': [
      ...(cosmos
        ? [
            {
              kind: 'orbit' as const,
              inclDeg: cosmos.inclMedianDeg,
              color: DEBRIS_PALETTE.cosmos2251,
              title: '宇宙 2251',
              value: `${fixed(cosmos.inclMedianDeg)}° · ${int(cosmos.count)} 个`,
              side: 1 as const,
            },
          ]
        : []),
      ...(iridium
        ? [
            {
              kind: 'orbit' as const,
              inclDeg: iridium.inclMedianDeg,
              color: DEBRIS_PALETTE.iridium33,
              title: '铱星 33',
              value: `${fixed(iridium.inclMedianDeg)}° · ${int(iridium.count)} 个`,
              side: -1 as const,
            },
          ]
        : []),
    ],
    'impact-plane': [
      ...(cosmos
        ? [
            {
              kind: 'orbit' as const,
              inclDeg: cosmos.inclMedianDeg,
              color: DEBRIS_PALETTE.cosmos2251,
              title: '宇宙 2251 轨道面',
              value: `${fixed(cosmos.inclMedianDeg)}°`,
              side: 1 as const,
            },
          ]
        : []),
      ...(iridium
        ? [
            {
              kind: 'orbit' as const,
              inclDeg: iridium.inclMedianDeg,
              color: DEBRIS_PALETTE.iridium33,
              title: '铱星 33 轨道面',
              value: `${fixed(iridium.inclMedianDeg)}°`,
              side: -1 as const,
            },
          ]
        : []),
    ],

    // ---------- 第五章 ----------
    'decay-now': shells,
    'decay-observe': [
      {
        kind: 'limb',
        altKm: 400,
        color: 0x4fc3f7,
        title: '400 km 以下',
        value: '十九年清掉九成九',
        side: 1,
      },
      {
        kind: 'limb',
        altKm: 850,
        color: 0xff6b35,
        title: '800 km 以上',
        value: '几乎一个没动',
        side: -1,
      },
    ],
    'decay-project': [
      ...shells,
      {
        kind: 'limb',
        altKm: 400,
        color: 0x4fc3f7,
        title: (c) => (c.years < 1 ? '现在' : `${Math.round(c.years)} 年后`),
        value: (c) => `仍剩 ${int(c.remaining)} 个`,
        side: -1,
      },
    ],
    'decay-kessler': [
      {
        kind: 'band',
        loKm: 800,
        hiKm: 2000,
        color: 0xff6b35,
        title: '800 km 以上',
        value: '两百年后剩下的八成在这里',
        side: 1,
      },
    ],
  };
}
