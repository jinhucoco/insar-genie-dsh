import { type ReactNode } from "react";
/** 设置表单字段（与 host settings.ts 的 SettingsSchema 对齐） */
export interface SettingsShape {
    earthdataUser: string;
    earthdataPassword: string;
    gacosEmail: string;
    gacosImapAuthCode: string;
    enviIdl: string;
    sarscapeLib: string;
    workDir: string;
    poeorbDir: string;
    experimentDir: string;
}
export declare const DEFAULT_SETTINGS: SettingsShape;
/**
 * 规范化用户输入的路径，使 browse 后端能接受（它只认"真正限定的绝对路径"）。
 * Windows 宽松输入归一：
 * - 空/纯空白 -> 原样
 * - 裸盘符字母 "D"、"D:" -> "D:\"
 * - 已含盘符但缺反斜杠 "D:foo" -> "D:\foo"
 * - UNC 前缀 "\\server" -> "\\server\"（缺共享名时补斜杠，仍可能被后端拒，但已是合法前缀）
 * - 其它（含反斜杠/正斜杠的路径、UNC 完整路径、相对路径）原样返回，交后端裁决。
 * 导出以便单测。
 */
export declare function normalizePathInput(raw: string): string;
/**
 * 设置卡片：凭证/路径/POEORB 表单 + 实验列表。
 * 挂载于 settings.section（设置页插件区）。
 *
 * **受控组件**：value 全部来自 props.settings（父级经 settingsScope 从 host 读，含启动
 * 探测的 base 默认值），用户改动通过 onChange 通知父级写回 host。组件自己不持有状态，
 * 保证 host 值更新（scope 变化）能反映到字段。
 *
 * autoDetected 标记（若有）则额外显示"▲ 启动时自动定位"。
 */
export declare function SettingsCard(props: {
    settings?: Partial<SettingsShape>;
    experiments?: {
        id: string;
        name: string;
        terrain: string;
        status: string;
    }[];
    autoDetected?: {
        enviIdl?: boolean;
        sarscapeLib?: boolean;
    };
    onChange?: (next: SettingsShape) => void;
    onSave?: (s: SettingsShape) => void;
    /** 应用内目录浏览器：列出一级目录（browse 后端 host.listDirectory）。 */
    listDirectory?: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>;
    /** 应用内目录浏览器：在当前目录下新建子目录（browse 后端 host.createDirectory）。
     *  listDirectory/createDirectory 都来自 ctx.workspaces。 */
    createDirectory?: (path: string, name: string) => Promise<string>;
}): ReactNode;
/** 目录列出一级（与 host 返回的 DirectoryListing 对齐；client 独立声明避免 host 依赖）。 */
export interface DirectoryListing {
    path: string;
    home: string;
    crumbs: {
        name: string;
        path: string;
        hidden: boolean;
    }[];
    entries: {
        name: string;
        path: string;
        hidden: boolean;
    }[];
    truncated: boolean;
}
/**
 * 应用内目录浏览模态框（browse 后端驱动）：导航面包屑 + 一级目录列表 + 新建文件夹。
 * - 打开时首次列 current；点目录行进入子目录；面包屑/crumb 跳转；"选择此文件夹"回填。
 * - 由宿主 ctx.workspaces.listDirectory / createDirectory 提供；出错显示错误文本。
 */
export declare function DirectoryBrowserModal(props: {
    title: string;
    initialPath?: string;
    listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>;
    createDirectory?: (path: string, name: string) => Promise<string>;
    onPick: (path: string) => void;
    onClose: () => void;
}): ReactNode;
