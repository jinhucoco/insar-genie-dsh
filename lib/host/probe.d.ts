/** 探测 ENVI IDL 可执行文件路径 */
export declare function probeEnviIdl(fallback: string, roots?: string[]): string;
/** 探测 SARscape 根目录 -> 返回【auxiliary 级】路径（bat 拼 %SARSCAPE_LIB%\envi_extensions\idl\lib 需要） */
export declare function probeSarscape(fallback: string, roots?: string[]): string;
/** 规范化 SARscape 路径到 auxiliary 级（若已是 auxiliary/更深则原样返回）。
 *  2026-08-30 D5 修复：bat 统一用 %SARSCAPE_LIB%\envi_extensions\idl\lib，
 *  而探测/用户填写常是 SARscape 根（缺 \auxiliary）→ Execute 静默失败（SetParam 全 1 但 Execute=0）。 */
export declare function withAuxiliary(p: string): string;
/** 启动时组合探测，返回 base 层默认值（给 SettingsSchema 注入） */
export declare function probeDefaults(current: {
    enviIdl: string;
    sarscapeLib: string;
}): {
    enviIdl: string;
    sarscapeLib: string;
};
