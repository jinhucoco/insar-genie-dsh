export interface ConfigEnvInput {
    workDir: string;
    resultRoot: string;
    tmpDir: string;
    slcData: string;
    demFinal: string;
    enviIdl: string;
    sarscapeLib: string;
    gacosList: string;
    sarModules: string;
    slcRoi?: string;
    slcPolarization?: string;
    demRaw?: string;
    demDat?: string;
    demEnvi?: string;
}
/** 生成 config.env 文本（字段名与 experiment/bat 读取的一致）。 */
export declare function buildConfigEnv(input: ConfigEnvInput): string;
/** 写 config.env 到实验目录（resultRoot 根下）。 */
export declare function writeConfigEnv(resultRoot: string, input: ConfigEnvInput): string;
