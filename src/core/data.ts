/**
 * 运行时数据加载。
 *
 * 对外只暴露一个 loadSceneData()：把页面需要的全部数据一次取回。
 * 数据全部是构建期生成的静态文件，运行期不访问任何外部服务，
 * 因此答辩断网、评委离线打开都不会失败。
 */

/** 编目点云元信息。字段顺序必须与 catalog.bin 中的 stride 一致。 */
export interface CatalogMeta {
  epoch: string;
  source: string;
  count: number;
  failed: number;
  stride: number;
  fields: string[];
  orbitClassLabels: string[];
  categoryLabels: Record<string, string>;
  orbitClasses: Record<string, number>;
  categories: Record<string, number>;
  yearHistogram: Record<string, number>;
  units: Record<string, string>;
}

/** 编目构成统计（来自 CelesTrak SATCAT，口径与 GP 根数不同）。 */
export interface PopulationStats {
  generatedAt: string;
  source: string;
  sourceUrl: string;
  sourceNote: string;
  totalCatalogued: number;
  inOrbit: number;
  workingPayloads: number;
  payloadsInOrbit: number;
  failedPayloadsTracked: number;
  notWorkingPayloads: number;
  nonPayloadObjects: number;
  nonWorkingShare: number;
  /** 在轨构成，按「是否还能工作」切分；合计等于在轨总数 */
  breakdown: { key: string; label: string; count: number; share: number }[];
  breakdownSum: number;
  /** 按近地点高度的分布，覆盖全部编目在轨物体（含无公开根数者） */
  altitudeDistribution: {
    bands: {
      label: string;
      lo: number;
      hi: number;
      total: number;
      share: number;
      PAY: number;
      'R/B': number;
      DEB: number;
      UNK: number;
    }[];
    sum: number;
    noPerigee: number;
    unit: string;
    note: string;
  };
  composition: { code: string; label: string; count: number; share: number }[];
  statusCount: Record<string, number>;
  statusCodes: Record<string, string>;
}

export interface DebrisGroupMeta {
  key: string;
  label: string;
  event: string;
  color: string;
  count: number;
  perigeeMinKm: number;
  perigeeMedianKm: number;
  perigeeMaxKm: number;
  above800km: number;
}

export interface DebrisMeta {
  epoch: string;
  source: string;
  total: number;
  groups: DebrisGroupMeta[];
}

export interface SceneData {
  catalogMeta: CatalogMeta;
  /** 地固坐标，按 stride 排布：[x, y, z, launchYear, orbitClass, perigeeKm, category] */
  catalog: Float32Array;
  population: PopulationStats;
  /** 字段偏移，避免各处散落 magic number */
  offset: {
    x: number;
    y: number;
    z: number;
    launchYear: number;
    orbitClass: number;
    perigeeKm: number;
    category: number;
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 加载失败：HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * 把 SATCAT 的原始计数补进统计对象。
 *
 * SATCAT 里的对象按类型分为载荷、火箭残骸、碎片，而公开的 GP 轨道根数
 * 只维护其中一部分。两者的差值本身就是一个结论，因此在这里明确算出来，
 * 页面不需要自己推导。
 */
function deriveGap(population: PopulationStats, catalogMeta: CatalogMeta) {
  const renderableByType = catalogMeta.categories ?? {};
  const renderableTotal = catalogMeta.count;
  const workingRenderable = renderableByType['工作中的载荷'] ?? 0;

  return {
    renderableTotal,
    workingRenderable,
    // 编目在轨但本页画不出：公开轨道根数已不再维护
    unrenderable: population.inOrbit - renderableTotal,
    workingShareOfRenderable: (workingRenderable / renderableTotal) * 100,
    workingShareOfCatalogued: (population.workingPayloads / population.inOrbit) * 100,
  };
}

export type PopulationGap = ReturnType<typeof deriveGap>;

export interface LoadedData extends SceneData {
  gap: PopulationGap;
}

/** 数据文件的根路径。base 为 './' 时用相对路径，Pages 子路径下同样可用。 */
const DATA_BASE = 'data/';

export async function loadSceneData(): Promise<LoadedData> {
  const [catalogMeta, catalogBuf, population] = await Promise.all([
    fetchJson<CatalogMeta>(`${DATA_BASE}catalog-meta.json`),
    fetch(`${DATA_BASE}catalog.bin`).then((r) => {
      if (!r.ok) throw new Error(`catalog.bin 加载失败：HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
    fetchJson<PopulationStats>(`${DATA_BASE}population.json`),
  ]);

  const catalog = new Float32Array(catalogBuf);
  const idx = (name: string) => {
    const i = catalogMeta.fields.indexOf(name);
    if (i < 0) throw new Error(`catalog.bin 缺少字段：${name}`);
    return i;
  };

  const offset = {
    x: idx('ecefX'),
    y: idx('ecefY'),
    z: idx('ecefZ'),
    launchYear: idx('launchYear'),
    orbitClass: idx('orbitClass'),
    perigeeKm: idx('perigeeKm'),
    category: idx('category'),
  };

  const base: SceneData = { catalogMeta, catalog, population, offset };
  return { ...base, gap: deriveGap(population, catalogMeta) };
}
