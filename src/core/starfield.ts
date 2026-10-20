/**
 * 远景星场。
 *
 * 作用只有一个：给纯黑的背景一个可读的深度参照。没有星，球体像是贴在一块
 * 黑布上；有了星，镜头推近时远景会以不同速度掠过，读者能感到自己在移动。
 *
 * 实现上刻意做得很轻：1400 个点、单个 BufferGeometry、一次 draw call，
 * 不参与拾取，也不随地球自转（星是无穷远的参照，跟着球转反而穿帮）。
 */

import * as THREE from 'three';

export interface Starfield {
  points: THREE.Points;
  update(dt: number): void;
}

export function createStarfield(scene: THREE.Scene): Starfield {
  const COUNT = 1400;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const sizes = new Float32Array(COUNT);

  // 确定性分布：刷新页面后星空位置不变，截图对比才有意义。
  // 这是画面布局用的伪随机（线性同余），不涉及任何安全或加密用途。
  let seed = 0x2f6e2b1;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const palette = [
    new THREE.Color(0xdceaf5),
    new THREE.Color(0x9fc4dd),
    new THREE.Color(0xf2d9b0),
  ];

  for (let i = 0; i < COUNT; i += 1) {
    // 球壳上均匀取点：z 均匀、方位角均匀，避免两极堆积。
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = 26 + rand() * 40;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    positions[i * 3] = Math.cos(a) * s * r;
    positions[i * 3 + 1] = z * r;
    positions[i * 3 + 2] = Math.sin(a) * s * r;

    const c = palette[Math.floor(rand() * palette.length)];
    const dim = 0.45 + rand() * 0.55;
    colors[i * 3] = c.r * dim;
    colors[i * 3 + 1] = c.g * dim;
    colors[i * 3 + 2] = c.b * dim;

    // 少数亮星大一点，其余保持 1 像素级，避免喧宾夺主。
    sizes[i] = rand() > 0.94 ? 2.2 : 1.1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = dot(uv, uv);
        if (d > 0.25) discard;
        float core = 1.0 - smoothstep(0.0, 0.25, d);
        gl_FragColor = vec4(vColor, core);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -1;
  scene.add(points);

  let spin = 0;

  return {
    points,
    update(dt) {
      // 极慢的整体自转：静止的星空看起来像贴图，转一点才有天球的感觉。
      spin += dt * 0.004;
      points.rotation.y = spin;
    },
  };
}
