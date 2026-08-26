import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { PanelCard } from "./shared.js";
export const DEFAULT_SETTINGS = {
    earthdataUser: "",
    earthdataPassword: "",
    gacosEmail: "",
    gacosImapAuthCode: "",
    enviIdl: "",
    sarscapeLib: "",
    workDir: "G:\\",
    poeorbDir: "",
    experimentDir: "",
};
const FIELD_LABELS = {
    earthdataUser: "ASF 账号",
    earthdataPassword: "ASF 密码",
    gacosEmail: "GACOS 邮箱",
    gacosImapAuthCode: "GACOS 邮箱 IMAP 授权码",
    enviIdl: "ENVI IDL 路径",
    sarscapeLib: "SARscape 路径",
    workDir: "实验预处理数据目录",
    poeorbDir: "POEORB 目录",
    experimentDir: "实验结果存放目录（留空=注册的 exp.dir）",
};
/** 通过"应用内目录浏览器"设置的**文件夹**字段（browse 后端 -> listDirectory）。
 *  （enviIdl/sarscapeLib 虽也是路径，但指向可执行文件，未纳入文件夹浏览。） */
const FOLDER_FIELDS = ["workDir", "poeorbDir", "experimentDir"];
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
export function normalizePathInput(raw) {
    const s = raw.trim();
    if (!s)
        return s;
    // 匹配盘符开头：盘符字母 + 可选冒号 + 余下任意路径。
    // 之后再补一个反斜杠、剥掉开头多余分隔符，使结果形如 "D:\..."。
    const drive = /^([A-Za-z]):?(.*)$/.exec(s);
    if (drive) {
        const letter = drive[1].toUpperCase();
        const rest = drive[2].replace(/^[\\/]+/, "");
        return `${letter}:\\${rest}`;
    }
    // UNC 起始（\\ 或 //）：原样返回（完整前缀由后端裁决）
    if (/^[\\/]{2}/.test(s))
        return s;
    return s;
}
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
export function SettingsCard(props) {
    const settings = { ...DEFAULT_SETTINGS, ...(props.settings ?? {}) };
    // 敏感字段"显示/隐藏"状态（仅本地 UI，不影响持久化；key = 敏感字段名）
    const [revealed, setRevealed] = useState({});
    // 目录浏览器状态：pickFor 非空时打开对应字段的目录浏览模态框
    const [pickFor, setPickFor] = useState(null);
    // "已保存"提示状态：保存成功后显示，自动消失
    const [saved, setSaved] = useState(false);
    const update = (key, value) => {
        props.onChange?.({ ...settings, [key]: value });
    };
    /** 保存：调用 onSave（同步 scope.set 写回 host），并显示"已保存"提示。 */
    const save = () => {
        props.onSave?.(settings);
        setSaved(true);
        // 提示自动消失
        window.setTimeout(() => setSaved(false), 2500);
    };
    /** 敏感字段（存密码/授权码，默认隐藏，可切换显示） */
    const isSecret = (key) => key === "earthdataPassword" || key === "gacosImapAuthCode";
    const toggleReveal = (key) => setRevealed((prev) => ({ ...prev, [key]: !prev[key] }));
    return (_jsxs(PanelCard, { title: "insar-genie \u8BBE\u7F6E", children: [_jsx("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }, children: Object.keys(FIELD_LABELS).map((key) => (_jsxs("label", { style: { display: "flex", flexDirection: "column", fontSize: 12 }, children: [FIELD_LABELS[key], _jsx("span", { style: { fontSize: 11, color: "#2e7d32" }, children: props.autoDetected?.[key] ? "▲ 启动时自动定位" : "" }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [_jsx("input", { type: isSecret(key) && !revealed[key] ? "password" : "text", value: settings[key], onChange: (e) => update(key, e.target.value), style: { marginTop: 2, padding: "2px 6px", flex: 1 } }), FOLDER_FIELDS.includes(key) && props.listDirectory && (_jsx("button", { type: "button", "aria-label": `浏览选择${FIELD_LABELS[key]}`, title: "\u5E94\u7528\u5185\u9009\u62E9\u6587\u4EF6\u5939", onClick: () => setPickFor(key), style: { marginTop: 2, padding: "2px 8px", cursor: "pointer" }, children: "\u6D4F\u89C8\u2026" })), isSecret(key) && (_jsx("button", { type: "button", "aria-label": revealed[key] ? `隐藏${FIELD_LABELS[key]}` : `显示${FIELD_LABELS[key]}`, onClick: () => toggleReveal(key), title: revealed[key] ? "隐藏" : "显示", style: {
                                        marginTop: 2,
                                        border: "none",
                                        background: "transparent",
                                        cursor: "pointer",
                                        fontSize: 14,
                                        padding: "2px 4px",
                                    }, children: revealed[key] ? "🙈" : "👁" }))] })] }, key))) }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 4 }, children: [_jsx("button", { onClick: save, style: { padding: "4px 12px" }, children: "\u4FDD\u5B58\u8BBE\u7F6E" }), saved && (_jsx("span", { role: "status", "aria-live": "polite", style: { fontSize: 12, color: "#2e7d32", display: "inline-flex", alignItems: "center", gap: 4 }, children: "\u2713 \u5DF2\u4FDD\u5B58" }))] }), pickFor && props.listDirectory && (_jsx(DirectoryBrowserModal, { title: FIELD_LABELS[pickFor], initialPath: settings[pickFor] || undefined, listDirectory: props.listDirectory, createDirectory: props.createDirectory, onPick: (p) => {
                    update(pickFor, p);
                    setPickFor(null);
                }, onClose: () => setPickFor(null) })), props.experiments && props.experiments.length > 0 && (_jsxs("div", { style: { marginTop: 16 }, children: [_jsx("div", { style: { fontWeight: 600, marginBottom: 4 }, children: "\u5B9E\u9A8C\u5217\u8868" }), _jsx("ul", { style: { margin: 0, paddingLeft: 16 }, children: props.experiments.map((e) => (_jsxs("li", { style: { fontSize: 13 }, children: [e.name, " \u00B7 ", e.terrain, " \u00B7 ", e.status] }, e.id))) })] }))] }));
}
/**
 * 应用内目录浏览模态框（browse 后端驱动）：导航面包屑 + 一级目录列表 + 新建文件夹。
 * - 打开时首次列 current；点目录行进入子目录；面包屑/crumb 跳转；"选择此文件夹"回填。
 * - 由宿主 ctx.workspaces.listDirectory / createDirectory 提供；出错显示错误文本。
 */
export function DirectoryBrowserModal(props) {
    const [current, setCurrent] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");
    // 路径输入框（Enter 跳到任意盘符/路径，跨 Windows 盘符的关键入口）
    const [pathInput, setPathInput] = useState("");
    // 初始列出（initialPath 若有则从其开始，否则 host home）
    useEffect(() => {
        const ac = new AbortController();
        setLoading(true);
        setError("");
        props
            .listDirectory(props.initialPath || undefined, ac.signal)
            .then((l) => setCurrent(l))
            .catch((e) => {
            if (!ac.signal.aborted)
                setError(e?.message ?? String(e));
        })
            .finally(() => setLoading(false));
        return () => ac.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const goTo = (path) => {
        const ac = new AbortController();
        setLoading(true);
        setError("");
        setPathInput(path);
        props
            .listDirectory(path, ac.signal)
            .then((l) => setCurrent(l))
            .catch((e) => {
            if (!ac.signal.aborted)
                setError(e?.message ?? String(e));
        })
            .finally(() => setLoading(false));
        return () => ac.abort();
    };
    /** 路径输入框提交：跳到任意盘符/路径（Windows 跨盘符入口）。 */
    const submitPath = () => {
        const p = pathInput.trim();
        if (!p)
            return;
        setPathInput(p);
        // host browse 后端只接受"真正限定的绝对路径"（如 D:\foo）；裸盘符/裸路径会被拒。
        // 这里把用户输入的宽松形式规范化成 host 认可的形式，再交给它。
        const run = goTo(normalizePathInput(p));
        // goTo 内部已处理 loading/error；此处无需额外处理
        void run;
    };
    const createDir = () => {
        if (!current || !newName.trim() || !props.createDirectory)
            return;
        setCreating(true);
        props
            .createDirectory(current.path, newName.trim())
            .then((p) => {
            setNewName("");
            goTo(p);
        })
            .catch((e) => setError(e?.message ?? String(e)))
            .finally(() => setCreating(false));
    };
    return (_jsx("div", { style: {
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
        }, onClick: props.onClose, children: _jsxs("div", { style: {
                background: "#fff",
                color: "#111",
                border: "1px solid #ccc",
                borderRadius: 8,
                width: "min(680px, 92vw)",
                maxHeight: "min(500px, 80vh)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }, onClick: (e) => e.stopPropagation(), children: [_jsx("div", { style: { padding: "14px 20px", borderBottom: "1px solid #eee", fontWeight: 600 }, children: props.title }), _jsxs("div", { style: { padding: "6px 20px", borderBottom: "1px solid #f0f0f0", fontSize: 13 }, children: [_jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }, children: (current?.crumbs ?? []).map((c, i) => (_jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [i > 0 && _jsx("span", { style: { color: "#999" }, children: "\u203A" }), _jsx("button", { onClick: () => goTo(c.path), style: { border: "none", background: "none", cursor: "pointer", color: c.path === current?.path ? "#111" : "#3b82f6", padding: 0, fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: c.name })] }, c.path))) }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, marginTop: 4 }, children: [_jsx("input", { value: pathInput, onChange: (e) => setPathInput(e.target.value), onKeyDown: (e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            submitPath();
                                        }
                                    }, placeholder: "\u8F93\u5165\u8DEF\u5F84\uFF08\u5982 D:\\work\uFF09\u540E\u56DE\u8F66", style: { flex: 1, padding: "4px 8px", fontSize: 12, border: "1px solid #ccc", borderRadius: 4, minWidth: 0 } }), _jsx("button", { onClick: submitPath, style: { padding: "4px 10px", fontSize: 12, cursor: "pointer", border: "1px solid #ccc", borderRadius: 4, background: "#f5f5f5" }, children: "\u8DF3\u5230" })] })] }), _jsxs("div", { style: { flex: 1, overflowY: "auto", padding: "8px 12px" }, children: [loading && _jsx("div", { style: { color: "#666", padding: "8px 12px", fontSize: 13 }, children: "\u52A0\u8F7D\u4E2D\u2026" }), error && _jsx("div", { style: { color: "#c0392b", padding: "8px 12px", fontSize: 13 }, children: error }), !loading && !error && (_jsxs("div", { children: [current && current.path !== current.home && (_jsx("button", { onClick: () => goTo((current.crumbs[current.crumbs.length - 2]?.path) ?? current.home), style: { display: "block", width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "6px 8px", fontSize: 13, color: "#555" }, children: "\u21A9 \u4E0A\u4E00\u7EA7" })), (current?.entries ?? []).map((e) => (_jsxs("button", { onClick: () => goTo(e.path), style: { display: "block", width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "6px 8px", fontSize: 13 }, onMouseEnter: (ev) => (ev.currentTarget.style.background = "#f0f0f0"), onMouseLeave: (ev) => (ev.currentTarget.style.background = "none"), children: ["\uD83D\uDCC1 ", e.name] }, e.path))), !loading && !error && (current?.entries ?? []).length === 0 && (_jsx("div", { style: { color: "#888", padding: "12px", fontSize: 13 }, children: "\uFF08\u7A7A\u76EE\u5F55\uFF09" }))] }))] }), _jsxs("div", { style: { padding: "10px 20px", borderTop: "1px solid #eee", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [props.createDirectory && (_jsxs(_Fragment, { children: [_jsx("input", { value: newName, onChange: (e) => setNewName(e.target.value), placeholder: "\u65B0\u5EFA\u6587\u4EF6\u5939\u540D", style: { padding: "4px 8px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4, flex: 1, minWidth: 140 }, disabled: creating }), _jsx("button", { onClick: createDir, style: { padding: "4px 10px", fontSize: 13, cursor: "pointer" }, disabled: creating || !newName.trim(), children: "\u65B0\u5EFA\u6587\u4EF6\u5939" })] })), _jsx("div", { style: { flex: 1 } }), _jsx("button", { onClick: () => current && props.onPick(current.path), style: { padding: "5px 14px", fontSize: 13, cursor: "pointer", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 4 }, children: "\u9009\u62E9\u6B64\u6587\u4EF6\u5939" }), _jsx("button", { onClick: props.onClose, style: { padding: "5px 14px", fontSize: 13, cursor: "pointer", border: "1px solid #ccc", borderRadius: 4, background: "#fff" }, children: "\u53D6\u6D88" })] })] }) }));
}
