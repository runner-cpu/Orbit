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
  inclMinDeg: number;
  inclMedianDeg: number;
  inclMaxDeg: number;
}

export interface DebrisMeta {
  epoch: string;
  source: string;
  total: number;
  stride: number;
  fields: string[];
  groupKeys: string[];
  groups: DebrisGroupMeta[];
  units: Record<string, string>;
}

/** 碎片点云。字段顺序必须与 debris.bin 中的 stride 一致。 */
export interface DebrisData {
  meta: DebrisMeta;
  /** 按 stride 排布：[x, y, z, perigeeKm, apogeeKm, inclDeg, groupId, noradId] */
  points: Float32Array;
  /** 本次实际下载的字节数（点云 + 元数据），用于方法页的离线包体积 */
  bytes: number;
  offset: {
    x: number;
    y: number;
    z: number;
    perigeeKm: number;
    apogeeKm: number;
    inclDeg: number;
    groupId: number;
    noradId: number;
  };
}

// ---------- 第二章与第五章的历史序列 ----------

export interface HistorySeriesPoint {
  year: number;
  inOrbit: number;
  debris: number;
  delta: number;
  deltaDebris: number;
}

export interface HistoryJump {
  year: number;
  delta: number;
  inOrbit: number;
  deltaDebris: number;
  debrisShare: number | null;
}

export interface FamilyDecayYear {
  year: number;
  decayed: number;
  cumulative: number;
  remaining: number;
}

export interface FamilyHistory {
  key: string;
  label: string;
  event: string;
  total: number;
  alive: number;
  decayed: number;
  decayedShare: number;
  remaining: number;
  remainingShare: number;
  decay: FamilyDecayYear[];
}

export interface BandStat {
  label: string;
  lo: number;
  hi: number | null;
  alive: number;
  decayed: number;
  total: number;
  removedShare: number | null;
}

export interface BandDecay extends BandStat {
  initial: number;
  tauYears: number | null;
  note: string | null;
}

export interface Projection {
  years: number;
  bands: { label: string; remaining: number; share: number | null; estimated: boolean }[];
  totalRemaining: number;
}

export interface HistoryData {
  generatedAt: string;
  source: string;
  sourceNote: string;
  firstYear: number;
  lastYear: number;
  medianDelta: number;
  jumps: HistoryJump[];
  series: HistorySeriesPoint[];
  families: FamilyHistory[];
  debrisSummary: {
    total: number;
    alive: number;
    decayed: number;
    decayedShare: number;
    remainingShare: number;
  };
  bandStats: BandStat[];
  bandTotal: number;
  bandDecay: BandDecay[];
  projections: Projection[];
  bandNote: string;
  projectionNote: string;
}

export interface SceneData {
  catalogMeta: CatalogMeta;
  /** 地固坐标，按 stride 排布：[x, y, z, launchYear, orbitClass, perigeeKm, category, noradId] */
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
    /** NORAD 编目号。读数卡用它回答「这是编目里的哪一个」。 */
    noradId: number;
  };
  /**
   * 本次实际下载的字节数。
   *
   * 为什么让加载器自己记而不是在页面里写常量：数据文件会随编目更新而变化，
   * 写死的体积迟早与实际不符，而「运行时数据量」这句话是对观众的承诺，
   * 不该靠人工同步。
   */
  bytes: number;
}

async function fetchJson<T>(url: string): Promise<{ data: T; bytes: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 加载失败：HTTP ${res.status}`);
  const text = await res.text();
  return { data: JSON.parse(text) as T, bytes: text.length };
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

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 加载失败：HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function loadSceneData(): Promise<LoadedData> {
  const [metaRes, catalogBuf, popRes] = await Promise.all([
    fetchJson<CatalogMeta>(`${DATA_BASE}catalog-meta.json`),
    fetchBuffer(`${DATA_BASE}catalog.bin`),
    fetchJson<PopulationStats>(`${DATA_BASE}population.json`),
  ]);
  const catalogMeta = metaRes.data;
  const population = popRes.data;

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
    noradId: idx('noradId'),
  };

  const bytes = metaRes.bytes + catalogBuf.byteLength + popRes.bytes;
  const base: SceneData = { catalogMeta, catalog, population, offset, bytes };
  return { ...base, gap: deriveGap(population, catalogMeta) };
}

/** 碎片点云。与编目点云分开取，因为只有第三、四章需要它。 */
export async function loadDebrisData(): Promise<DebrisData> {
  const [metaRes, buf] = await Promise.all([
    fetchJson<DebrisMeta>(`${DATA_BASE}debris-meta.json`),
    fetchBuffer(`${DATA_BASE}debris.bin`),
  ]);
  const meta = metaRes.data;
  const points = new Float32Array(buf);
  const idx = (name: string) => {
    const i = meta.fields.indexOf(name);
    if (i < 0) throw new Error(`debris.bin 缺少字段：${name}`);
    return i;
  };
  return {
    meta,
    points,
    bytes: metaRes.bytes + buf.byteLength,
    offset: {
      x: idx('ecefX'),
      y: idx('ecefY'),
      z: idx('ecefZ'),
      perigeeKm: idx('perigeeKm'),
      apogeeKm: idx('apogeeKm'),
      inclDeg: idx('inclDeg'),
      groupId: idx('groupId'),
      noradId: idx('noradId'),
    },
  };
}

/**
 * 编目对象名。按行与 catalog.bin 的对象顺序一一对应。
 *
 * 为什么单独取、而且第一次点选才取：名称附表 223 KB，gzip 后 51 KB，
 * 比整个点云还大。绝大多数读者只看画面不点选，把它塞进首屏关键路径
 * 会白白拖慢第一章。真正需要它的时刻只有一个：卡片要写出对象名。
 */
export type CatalogNames = string[];

export async function loadCatalogNames(): Promise<CatalogNames> {
  const res = await fetch(`${DATA_BASE}catalog-names.txt`);
  if (!res.ok) throw new Error(`catalog-names.txt 加载失败：HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  // 文件末尾带一个换行，split 之后会多出一个空串，只去掉这一个。
  // 不用 filter 全量去空：名称理论上可以为空，按行对齐的语义不能动。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 第二章与第五章的历史序列。 */
export type HistoryDataWithSize = HistoryData & { bytes: number };

export async function loadHistoryData(): Promise<HistoryDataWithSize> {
  const { data, bytes } = await fetchJson<HistoryData>(`${DATA_BASE}history.json`);
  return { ...data, bytes };
}
