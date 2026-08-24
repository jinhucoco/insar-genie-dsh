import { type ExperimentParams, type TerrainType } from "../shared/types.js";

export { validateBaseline } from "../shared/baseline.js";

/** 地形参数表（来源：SKILL.md 实验参数设置提醒机制 + 用户方法论）。
 *  多视范围由 gridSize 推导（30m→8:2 / 15m→4:1），此处给出典型值；coherence/displacement 按地形。 */
const TEMPLATES: Record<TerrainType, ExperimentParams> = {
  mining: {
    rgLooks: 7, azLooks: 2, gridSize: 15,
    maxTimeBaselineDays: 90, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.2,
    displacementModel: "quadratic", coherenceThreshold: 0.2,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 15,
    useGacos: true, demFile: "",
  },
  landslide: {
    rgLooks: 7, azLooks: 2, gridSize: 30,
    maxTimeBaselineDays: 180, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.2,
    displacementModel: "linear", coherenceThreshold: 0.2,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 30,
    useGacos: true, demFile: "",
  },
  urban: {
    rgLooks: 5, azLooks: 1, gridSize: 15,
    maxTimeBaselineDays: 180, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF", unwrapCohThreshold: 0.3,
    displacementModel: "linear", coherenceThreshold: 0.3,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 15,
    useGacos: true, demFile: "",
  },
  desert: {
    rgLooks: 8, azLooks: 2, gridSize: 30,
    maxTimeBaselineDays: 180, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.2,
    displacementModel: "linear", coherenceThreshold: 0.2,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 30,
    useGacos: true, demFile: "",
  },
  loess: {
    rgLooks: 8, azLooks: 2, gridSize: 30,
    maxTimeBaselineDays: 180, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.15,
    displacementModel: "linear", coherenceThreshold: 0.2,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 30,
    useGacos: true, demFile: "",
  },
};

export function getTemplate(terrain: TerrainType): ExperimentParams {
  const t = TEMPLATES[terrain];
  if (!t) throw new Error(`unknown terrain: ${terrain}`);
  return { ...t };
}

/** 迭代修正多视：由 gridSize 推导 RG/AZ（30m→8:2，15m→4:1~5:1）。 */
export function looksFromGridSize(gridSize: number): { rgLooks: number; azLooks: number } {
  if (gridSize >= 30) return { rgLooks: 8, azLooks: 2 };
  return { rgLooks: 4, azLooks: 1 };
}
