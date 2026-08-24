import { useEffect, useState, type ReactNode } from "react";
import { PanelCard } from "./shared.js";

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
}

export const DEFAULT_SETTINGS: SettingsShape = {
  earthdataUser: "",
  earthdataPassword: "",
  gacosEmail: "",
  gacosImapAuthCode: "",
  enviIdl: "",
  sarscapeLib: "",
  workDir: "G:\\",
  poeorbDir: "",
};

const FIELD_LABELS: Record<keyof SettingsShape, string> = {
  earthdataUser: "ASF 账号",
  earthdataPassword: "ASF 密码",
  gacosEmail: "GACOS 邮箱",
  gacosImapAuthCode: "GACOS 邮箱 IMAP 授权码",
  enviIdl: "ENVI IDL 路径",
  sarscapeLib: "SARscape 路径",
  workDir: "工作目录",
  poeorbDir: "POEORB 目录",
};

/** 通过"应用内目录浏览器"设置的**文件夹**字段（browse 后端 -> listDirectory）。
 *  （enviIdl/sarscapeLib 虽也是路径，但指向可执行文件，未纳入文件夹浏览。） */
const FOLDER_FIELDS: (keyof SettingsShape)[] = ["workDir", "poeorbDir"];

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
export function SettingsCard(props: {
  settings?: Partial<SettingsShape>;
  experiments?: { id: string; name: string; terrain: string; status: string }[];
  autoDetected?: { enviIdl?: boolean; sarscapeLib?: boolean };
  onChange?: (next: SettingsShape) => void;
  onSave?: (s: SettingsShape) => void;
  /** 应用内目录浏览器：列出一级目录（browse 后端 host.listDirectory）。 */
  listDirectory?: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>;
  /** 应用内目录浏览器：在当前目录下新建子目录（browse 后端 host.createDirectory）。
   *  listDirectory/createDirectory 都来自 ctx.workspaces。 */
  createDirectory?: (path: string, name: string) => Promise<string>;
}): ReactNode {
  const settings: SettingsShape = { ...DEFAULT_SETTINGS, ...(props.settings ?? {}) };
  // 敏感字段"显示/隐藏"状态（仅本地 UI，不影响持久化；key = 敏感字段名）
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  // 目录浏览器状态：pickFor 非空时打开对应字段的目录浏览模态框
  const [pickFor, setPickFor] = useState<keyof SettingsShape | null>(null);

  const update = (key: keyof SettingsShape, value: string) => {
    props.onChange?.({ ...settings, [key]: value });
  };

  /** 敏感字段（存密码/授权码，默认隐藏，可切换显示） */
  const isSecret = (key: keyof SettingsShape) =>
    key === "earthdataPassword" || key === "gacosImapAuthCode";

  const toggleReveal = (key: string) =>
    setRevealed((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <PanelCard title="insar-genie 设置">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        {(Object.keys(FIELD_LABELS) as (keyof SettingsShape)[]).map((key) => (
          <label key={key} style={{ display: "flex", flexDirection: "column", fontSize: 12 }}>
            {FIELD_LABELS[key]}
            <span style={{ fontSize: 11, color: "#2e7d32" }}>
              {props.autoDetected?.[key as "enviIdl" | "sarscapeLib"] ? "▲ 启动时自动定位" : ""}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type={isSecret(key) && !revealed[key] ? "password" : "text"}
                value={settings[key]}
                onChange={(e) => update(key, e.target.value)}
                style={{ marginTop: 2, padding: "2px 6px", flex: 1 }}
              />
              {FOLDER_FIELDS.includes(key) && props.listDirectory && (
                <button
                  type="button"
                  aria-label={`浏览选择${FIELD_LABELS[key]}`}
                  title="应用内选择文件夹"
                  onClick={() => setPickFor(key)}
                  style={{ marginTop: 2, padding: "2px 8px", cursor: "pointer" }}
                >
                  浏览…
                </button>
              )}
              {isSecret(key) && (
                <button
                  type="button"
                  aria-label={revealed[key] ? `隐藏${FIELD_LABELS[key]}` : `显示${FIELD_LABELS[key]}`}
                  onClick={() => toggleReveal(key)}
                  title={revealed[key] ? "隐藏" : "显示"}
                  style={{
                    marginTop: 2,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: "2px 4px",
                  }}
                >
                  {/* 眼睛图标：⊕ 显示 / ⊖ 隐藏（无第三方图标依赖） */}
                  {revealed[key] ? "🙈" : "👁"}
                </button>
              )}
            </div>
          </label>
        ))}
      </div>
      <button onClick={() => props.onSave?.(settings)} style={{ padding: "4px 12px" }}>
        保存设置
      </button>

      {pickFor && props.listDirectory && (
        <DirectoryBrowserModal
          title={FIELD_LABELS[pickFor]}
          initialPath={settings[pickFor] || undefined}
          listDirectory={props.listDirectory}
          createDirectory={props.createDirectory}
          onPick={(p) => {
            update(pickFor, p);
            setPickFor(null);
          }}
          onClose={() => setPickFor(null)}
        />
      )}

      {props.experiments && props.experiments.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>实验列表</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {props.experiments.map((e) => (
              <li key={e.id} style={{ fontSize: 13 }}>
                {e.name} · {e.terrain} · {e.status}
              </li>
            ))}
          </ul>
        </div>
      )}
    </PanelCard>
  );
}

/** 目录列出一级（与 host 返回的 DirectoryListing 对齐；client 独立声明避免 host 依赖）。 */
export interface DirectoryListing {
  path: string;
  home: string;
  crumbs: { name: string; path: string; hidden: boolean }[];
  entries: { name: string; path: string; hidden: boolean }[];
  truncated: boolean;
}

/**
 * 应用内目录浏览模态框（browse 后端驱动）：导航面包屑 + 一级目录列表 + 新建文件夹。
 * - 打开时首次列 current；点目录行进入子目录；面包屑/crumb 跳转；"选择此文件夹"回填。
 * - 由宿主 ctx.workspaces.listDirectory / createDirectory 提供；出错显示错误文本。
 */
export function DirectoryBrowserModal(props: {
  title: string;
  initialPath?: string;
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>;
  createDirectory?: (path: string, name: string) => Promise<string>;
  onPick: (path: string) => void;
  onClose: () => void;
}): ReactNode {
  const [current, setCurrent] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // 初始列出（initialPath 若有则从其开始，否则 host home）
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    props
      .listDirectory(props.initialPath || undefined, ac.signal)
      .then((l) => setCurrent(l))
      .catch((e) => {
        if (!ac.signal.aborted) setError(e?.message ?? String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = (path: string) => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    props
      .listDirectory(path, ac.signal)
      .then((l) => setCurrent(l))
      .catch((e) => {
        if (!ac.signal.aborted) setError(e?.message ?? String(e));
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  };

  const createDir = () => {
    if (!current || !newName.trim() || !props.createDirectory) return;
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={props.onClose}
    >
      <div
        style={{
          background: "#fff",
          color: "#111",
          border: "1px solid #ccc",
          borderRadius: 8,
          width: "min(680px, 92vw)",
          maxHeight: "min(500px, 80vh)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #eee", fontWeight: 600 }}>
          {props.title}
        </div>

        <div style={{ padding: "6px 20px", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {(current?.crumbs ?? []).map((c, i) => (
              <span key={c.path} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <span style={{ color: "#999" }}>›</span>}
                <button
                  onClick={() => goTo(c.path)}
                  style={{ border: "none", background: "none", cursor: "pointer", color: c.path === current?.path ? "#111" : "#3b82f6", padding: 0, fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{current?.path ?? ""}</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
          {loading && <div style={{ color: "#666", padding: "8px 12px", fontSize: 13 }}>加载中…</div>}
          {error && <div style={{ color: "#c0392b", padding: "8px 12px", fontSize: 13 }}>{error}</div>}
          {!loading && !error && (
            <div>
              {current && current.path !== current.home && (
                <button
                  onClick={() => goTo((current.crumbs[current.crumbs.length - 2]?.path) ?? current.home)}
                  style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "6px 8px", fontSize: 13, color: "#555" }}
                >
                  ↩ 上一级
                </button>
              )}
              {(current?.entries ?? []).map((e) => (
                <button
                  key={e.path}
                  onClick={() => goTo(e.path)}
                  style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "6px 8px", fontSize: 13 }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = "#f0f0f0")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = "none")}
                >
                  📁 {e.name}
                </button>
              ))}
              {!loading && !error && (current?.entries ?? []).length === 0 && (
                <div style={{ color: "#888", padding: "12px", fontSize: 13 }}>（空目录）</div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "10px 20px", borderTop: "1px solid #eee", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {props.createDirectory && (
            <>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="新建文件夹名"
                style={{ padding: "4px 8px", fontSize: 13, border: "1px solid #ccc", borderRadius: 4, flex: 1, minWidth: 140 }}
                disabled={creating}
              />
              <button onClick={createDir} style={{ padding: "4px 10px", fontSize: 13, cursor: "pointer" }} disabled={creating || !newName.trim()}>
                新建文件夹
              </button>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => current && props.onPick(current.path)} style={{ padding: "5px 14px", fontSize: 13, cursor: "pointer", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 4 }}>
            选择此文件夹
          </button>
          <button onClick={props.onClose} style={{ padding: "5px 14px", fontSize: 13, cursor: "pointer", border: "1px solid #ccc", borderRadius: 4, background: "#fff" }}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
