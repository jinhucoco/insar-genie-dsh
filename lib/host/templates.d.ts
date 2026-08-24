import { type ExperimentParams, type TerrainType } from "../shared/types.js";
export { validateBaseline } from "../shared/baseline.js";
export declare function getTemplate(terrain: TerrainType): ExperimentParams;
/** 迭代修正多视：由 gridSize 推导 RG/AZ（30m→8:2，15m→4:1~5:1）。 */
/** 由 gridSize 推导多视（30m→8:2 / 15m→4:1）。
 *  ⚠️ 这是【无地形时的兑底】——具体地形优先用 getTemplate(terrain) 的 rgLooks/azLooks（如 urban 15m→5:1）。
 *  不会覆盖地形模板的多视。 */
export declare function looksFromGridSize(gridSize: number): {
    rgLooks: number;
    azLooks: number;
};
