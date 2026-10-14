/**
 * satellite.js 纯 JS 实现的本地封装。
 *
 * 为什么需要这个文件：
 *   satellite.js v7 的包入口（dist/index.js）除了导出 SGP4 实现之外，还会
 *   连带导出 WASM 批量解算器。那部分模块使用顶层 await 与 node: 内置模块，
 *   在浏览器打包时会失败。本项目只用标准 SGP4，不需要 WASM 路径。
 *
 *   包的 exports 字段只暴露了根入口，无法用 'satellite.js/dist/io.js' 这种
 *   子路径导入；因此这里改用相对路径直接引用其 dist 下的具体实现文件，
 *   避开 WASM 分支。SGP4 纯 JS 链路（io → sgp4init → sgp4 → dpper 等）
 *   内部全部使用相对导入，不依赖包内其它入口，因此这样引用是安全的。
 *
 *   vite.config.ts 中把裸模块名 'satellite.js' 别名到本文件，
 *   使业务代码仍按常规写法导入，不需要关心这一层。
 */
export { twoline2satrec, json2satrec } from '../../node_modules/satellite.js/dist/io.js';
export { propagate, sgp4, gstime } from '../../node_modules/satellite.js/dist/propagation.js';
export { jday, invjday } from '../../node_modules/satellite.js/dist/ext.js';
export { SatRecError } from '../../node_modules/satellite.js/dist/propagation/SatRec.js';
export type { SatRec } from '../../node_modules/satellite.js/dist/propagation/SatRec.js';
export type {
  PositionAndVelocity,
  EciVec3,
  Kilometer,
} from '../../node_modules/satellite.js/dist/common-types.js';
