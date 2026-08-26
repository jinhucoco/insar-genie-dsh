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
    /** 空间基线（% of critical）：连接图 bat 读 %MAX_PERC_BASELINE%（B2 扩基线门生效的关键字段） */
    maxPercBaseline?: number;
    /** 时间基线（天）：连接图 bat 读 %MAX_TIME_BASELINE% */
    maxTimeBaselineDays?: number;
    /** 连接图中央超参考（SLC msc_slc_list 路径）：bat 读 %SUPER_REFERENCE%；空 = bat 内置兑底 */
    superReference?: string;
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
