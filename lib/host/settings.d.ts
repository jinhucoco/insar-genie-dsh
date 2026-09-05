import { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
/** 设置命名空间：0.1.2 起 settingsNamespace() 工厂已移除，改为字符串字面量
 *  （SettingsNamespaceInput 模板字面量类型校验 /^[a-z][a-z0-9-]*$/，
 *  必须是小写 kebab-case，"insarGenie" 会抛 TypeError）。 */
export declare const SETTINGS_NS = "insar-genie";
/** 设置项 schema（enviIdl/sarscapeLib 的默认值是兜底；实际值由 probeDefaults 在 base 层覆盖） */
export declare const SettingsSchema: z<Schemastery.ObjectS<{
    earthdataUser: z<string, string>;
    earthdataPassword: z<string, string>;
    gacosEmail: z<string, string>;
    /** GACOS 邮箱 IMAP 授权码 —— 含 IMAP 术语更具体（明确是哪个邮箱的 IMAP 授权码）；
     *  当前 gacos_fetch.py 只实现 IMAP 收取，故字段语义即 IMAP 授权码 */
    gacosImapAuthCode: z<string, string>;
    enviIdl: z<string, string>;
    sarscapeLib: z<string, string>;
    workDir: z<string, string>;
    /** 精密轨道目录：默认 <实验目录>/poeorb，可覆盖为公共轨道库（**不探测**，用户自选存储位置） */
    poeorbDir: z<string, string>;
    /** 实验结果存放目录（B3：RESULT_ROOT/TMP_DIR 等 SARscape 输出所在；非空时替代注册的 exp.dir，留空回退 exp.dir）。
     *  注意：脚本根不在此配置——五步 bat 树 + config.env 始终来自插件内置 assets/experiment
     *  （高级用户可用 INSAR_GENIE_EXPERIMENT 环境变量覆盖），开箱即用、多实验共享一份脚本。 */
    experimentDir: z<string, string>;
}>, Schemastery.ObjectT<{
    earthdataUser: z<string, string>;
    earthdataPassword: z<string, string>;
    gacosEmail: z<string, string>;
    /** GACOS 邮箱 IMAP 授权码 —— 含 IMAP 术语更具体（明确是哪个邮箱的 IMAP 授权码）；
     *  当前 gacos_fetch.py 只实现 IMAP 收取，故字段语义即 IMAP 授权码 */
    gacosImapAuthCode: z<string, string>;
    enviIdl: z<string, string>;
    sarscapeLib: z<string, string>;
    workDir: z<string, string>;
    /** 精密轨道目录：默认 <实验目录>/poeorb，可覆盖为公共轨道库（**不探测**，用户自选存储位置） */
    poeorbDir: z<string, string>;
    /** 实验结果存放目录（B3：RESULT_ROOT/TMP_DIR 等 SARscape 输出所在；非空时替代注册的 exp.dir，留空回退 exp.dir）。
     *  注意：脚本根不在此配置——五步 bat 树 + config.env 始终来自插件内置 assets/experiment
     *  （高级用户可用 INSAR_GENIE_EXPERIMENT 环境变量覆盖），开箱即用、多实验共享一份脚本。 */
    experimentDir: z<string, string>;
}>>;
export type Settings = ReturnType<typeof SettingsSchema>;
/**
 * 注册设置命名空间。
 * 0.1.2 起 installSettingsSection 独立导出被移除：改为在注入 settings 服务后
 * 调 settingsCtx.settings.installSection(ctx, ns, schema, entry, hooks)
 * （官方 dsh-bash-local / dsh-llm-deepseek 同款模式；installSection 仍为 5 参数，
 * ns 为字符串字面量，entry 是 composition 层 base 值，hooks 提供 setSource/onChange）。
 *
 * 启动时路径探测：探测结果作为 entry（base 层）填入，用户设置的 user 层仍能覆盖，
 * 普通用户无需手动填 ENVI IDL / SARscape 路径。
 */
export declare function registerSettings(ctx: Context): void;
