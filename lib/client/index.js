import { createElement, useState, useEffect } from "react";
import { ProgressPanel } from "./ProgressPanel.js";
import { ParamConfirm } from "./ParamConfirm.js";
import { PipelineConfirm } from "./PipelineConfirm.js";
import { SettingsCard, DEFAULT_SETTINGS } from "./SettingsCard.js";
import { insarGenieDefinition, selectInsarTurn, } from "./conversation.js";
/**
 * insar-genie-dsh client 入口。
 * 通过 DSH client 插槽注册：
 * - conversationEvents：insar 工具结果（insar_status/insar_list/insar_register）累积为
 *   turn 级业务数据（conversation.ts 的 insarGenieDefinition）
 * - turnTail（conversation.chat.turnTail，chain）：当一轮 turn 有 insar 工具活动时认领，
 *   组件通过框架注入的 useSession 从会话快照提取最新 insar_status 结果并渲染进度面板
 * - settings.section：SettingsCard（设置页插件区）
 *
 * 数据接线（host→client）：DSH 无同步 host 工具调用通道，但 host 工具结果作为
 * tool/result 会话事件流入 client 的 ConversationSnapshot——组件订阅快照即拿到
 * 真实数据，无需 window 桥、无需轮询。window.insarGenieBridge 仅保留为可选
 * 注入位（未来 host 若提供 HTTP 桥可直接替换），默认数据源是会话快照。
 */
export const name = "insar-genie-dsh";
export const inject = ["slots", "uiConversation", "settingsScope", "workspaces"];
/** turnTail 组件（chain 注册，session 作用域）：
 * - matched：selectInsarTurn 的返回（该 turn 有 insar 工具活动才认领）——**本 turn 数据**
 * - 0.1.2 起 turnTail owner 注入面不再提供 useSession 会话快照选择器（旧 ConversationSnapshot 读取
 *   已随 dsh-client-runtime 拆包移除）；实时刷新改由 matched 承担——同一 turn 内 AI 再次调用
 *   insar_status → buildLocationData 重新发布 turn 数据 → select 重认领 → matched 重传 → 面板更新。
 */
export function InsarTurnTail(props) {
    const latest = props.matched;
    // 0) 全流程参数确认卡：insar_pipeline 的 5 卡结果（manual 模式一次性推送）。
    //    优先于其他分支：AI 发起全流程编排时先让用户确认 5 步参数再执行。
    if (props.matched?.pipeline) {
        return createElement(PipelineConfirm, {
            cards: props.matched.pipeline.cards,
            // (D2) onConfirmAll 收到用户编辑的字段值；无 host 同步通道时,把修改摘要写成
            // 可见文本提示 AI：用户改过参数,重调 insar_pipeline(confirmed=true, paramOverrides=<JSON>) 时带上。
            // 这样即使 client 无法直接调 host,修改也能通过 AI 下一轮带参执行真正生效。
            onConfirmAll: (edits) => {
                const changed = Object.entries(edits ?? {}).filter(([, v]) => v !== undefined && v !== "");
                if (changed.length === 0)
                    return;
                const summary = changed
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ");
                console.info(`[insar-genie] 用户修改参数: ${summary}`);
                const ev = new CustomEvent("insar-genie-params-changed", { detail: { edits } });
                window.dispatchEvent(ev);
            },
            onCancel: () => { },
        });
    }
    // 1) 参数确认卡：insar_templates 结果（agent 查模板后向用户确认参数）。
    //    优先于进度面板：同一 turn 既查模板又查状态时，先确认参数再展示进度。
    if (props.matched?.paramConfirm) {
        return createElement(ParamConfirm, {
            terrain: props.matched.paramConfirm.terrain,
            params: props.matched.paramConfirm.params,
            onConfirm: () => { },
            onCancel: () => { },
        });
    }
    // 2) 进度面板：仅当**本 turn** 有 insar_status 活动时渲染（matched.status 是本 turn 的
    //    最后结果）。快照 latest 只作为同一实验的实时刷新值——通过 snapshot prop 传入，
    //    快照更新会重渲染并更新面板（initial 只挂载生效，不能承担实时刷新）。
    //    0.1.2 下 latest 即 matched（select 重注入），语义等同快照刷新。
    //    无 matched.status 时不渲染进度面板，避免历史 turn 的 insar_status 泄漏压制
    //    本 turn 的 experiments/registered 分支。
    if (props.matched?.status) {
        return createElement(ProgressPanel, {
            experimentLabel: undefined,
            fetchStatus: window.insarGenieBridge?.fetchStatus,
            initial: props.matched.status,
            snapshot: latest?.status,
        });
    }
    if (props.matched?.experiments && props.matched.experiments.length > 0) {
        return createElement(SettingsCard, {
            experiments: props.matched.experiments,
            onSave: (s) => {
                console.info("[insar-genie] settings save requested", s);
            },
        });
    }
    if (props.matched?.registered && props.matched.registered.ok) {
        return createElement("div", {
            style: {
                border: "1px solid #ccc",
                borderRadius: 8,
                padding: 12,
                margin: "8px 0",
                maxWidth: 640,
                fontSize: 13,
            },
        }, `✅ 实验已注册：${props.matched.registered.experimentId}`);
    }
    return null;
}
/**
 * SettingsCardBound：绑定 settingsScope 的容器组件。
 * - 挂载时从 scope.getSnapshot().value 读 host 设置值（含启动探测 base 默认）
 * - 订阅 scope 变化 → 更新显示（host 值变更时字段跟随）
 * - onChange 通过 scope.set 逐字段写回 host
 */
export function SettingsCardBound(props) {
    const scope = props.scope;
    const [draft, setDraft] = useState(() => ({ ...DEFAULT_SETTINGS, ...(scope?.getSnapshot().value ?? {}) }));
    // 同步 host 值变化（编译期 scope 绑定后首次同步 + 订阅更新）
    useEffect(() => {
        const update = () => setDraft({ ...DEFAULT_SETTINGS, ...(scope?.getSnapshot().value ?? {}) });
        update();
        const unsub = scope?.subscribe(update);
        return () => {
            if (typeof unsub === "function")
                unsub();
        };
    }, [scope]);
    // 探测标记：host resolve 后 enviIdl/sarscapeLib 非空且是探测到的路径
    const env = scope?.getSnapshot().value;
    const autoDetected = {
        enviIdl: Boolean(env?.enviIdl),
        sarscapeLib: Boolean(env?.sarscapeLib),
    };
    return createElement(SettingsCard, {
        experiments: props.experiments,
        settings: draft,
        autoDetected,
        listDirectory: props.listDirectory,
        createDirectory: props.createDirectory,
        onChange: (next) => setDraft(next),
        onSave: (next) => {
            // 逐字段写回 host（scope.set 带修订号，序列化保证顺序）
            for (const [k, v] of Object.entries(next)) {
                scope?.set(k, v);
            }
        },
    });
}
export function apply(ctx) {
    // 1) uiConversation：累积 insar 工具结果到 turn 业务数据
    //    0.1.2 起旧 conversationEvents 服务随 dsh-client-runtime 拆包移除，
    //    改由 ctx.uiConversation.events.register（官方 ui-deliverables 同款）
    ctx.uiConversation.events.register(insarGenieDefinition);
    // 2) settings.section：设置卡片（设置页插件区，list + root scope）
    //    通过 ctx.settingsScope 绑定 "insar-genie" namespace，读/写 host 设置值
    //    （含启动时路径探测的 base 层默认值：ENVI IDL/SARscape 自动定位后在此显示）。
    const scope = ctx.settingsScope?.bind({ namespace: "insar-genie" });
    ctx.slots.inject("settings.section", () => {
        const off = ctx.slots.register({
            name: "settings.section",
            id: "insar-genie",
            order: 40,
            label: () => "insar-genie",
            inject: () => ({ experiments: window.insarGenieBridge?.experiments }),
        }, (props) => createElement(SettingsCardBound, {
            scope,
            experiments: props?.experiments,
            // 应用内目录浏览器原语（browse 后端 host.listDirectory/createDirectory）——
            // 仅供文件夹字段"浏览…"按钮自建的应用内模态框使用。
            listDirectory: (p, s) => ctx.workspaces?.listDirectory(p, s) ?? Promise.reject(new Error("workspaces 服务不可用")),
            createDirectory: (p, n) => ctx.workspaces?.createDirectory(p, n) ?? Promise.reject(new Error("workspaces 服务不可用")),
        }));
        return () => {
            if (typeof off === "function")
                off();
        };
    });
    // 3) conversation.chat.turnTail：进度面板（chain，session 作用域）
    //    chain 注册必须有 select：仅当该 turn 有 insar 工具活动时认领，否则 null 放行
    //    （deliverables 同款；缺 select 在真实 shell 注册时会 throw）
    ctx.slots.inject("conversation.chat.turnTail", () => {
        const off = ctx.slots.register({
            name: "conversation.chat.turnTail",
            select: selectInsarTurn,
            registrant: "insar-genie-dsh",
        }, InsarTurnTail);
        return () => {
            if (typeof off === "function")
                off();
        };
    });
}
