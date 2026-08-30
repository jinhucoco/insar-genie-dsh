import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { PanelCard } from "./shared.js";
/**
 * SBAS 全流程参数确认卡（5 步）：一次性推送每步的 field/GUI 名/默认/推荐/理由。
 * 挂载于 conversation.chat.turnTail；AI 生成卡片后渲染，用户可逐项确认/修改后执行。
 */
export function PipelineConfirm(props) {
    const [edits, setEdits] = useState({});
    return (_jsxs(PanelCard, { title: "SBAS \u5168\u6D41\u7A0B\u53C2\u6570\u786E\u8BA4\uFF085 \u6B65\uFF09", children: [props.cards.map((card) => (_jsxs("div", { style: { borderTop: "1px solid #ddd", padding: "8px 0" }, children: [_jsx("div", { style: { fontWeight: 600, margin: "6px 0" }, children: card.title }), card.params.map((p) => (_jsxs("label", { style: { display: "block", fontSize: 12, margin: "2px 0" }, children: [p.label, ":", _jsx("input", { type: "text", defaultValue: edits[p.key] ?? p.recommended, onChange: (e) => setEdits((prev) => ({ ...prev, [p.key]: e.target.value })), style: { marginLeft: 6, width: 90, border: "1px solid #ccc" } }), _jsxs("span", { style: { color: "#888", marginLeft: 6 }, children: ["\u9ED8\u8BA4 ", p.defaultValue, " \u00B7 \u63A8\u8350 ", p.recommended, " \u00B7 ", p.reason] })] }, p.field)))] }, card.title))), _jsxs("div", { style: { marginTop: 10 }, children: [_jsx("button", { onClick: () => props.onConfirmAll(edits), style: { marginRight: 8, padding: "4px 12px" }, children: "\u5168\u90E8\u786E\u8BA4" }), _jsx("button", { onClick: props.onCancel, style: { padding: "4px 12px" }, children: "\u53D6\u6D88" })] })] }));
}
