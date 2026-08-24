import { useState, type ReactNode } from "react";
import { PanelCard } from "./shared.js";

/** 五步确认卡定义（field/GUI 名/默认/推荐/理由），由 host insar_pipeline 生成传入。 */
export interface PipelineCard {
  title: string;
  params: {
    field: string;
    label: string;
    defaultValue: string;
    recommended: string;
    reason: string;
    key: string;
  }[];
}

/**
 * SBAS 全流程参数确认卡（5 步）：一次性推送每步的 field/GUI 名/默认/推荐/理由。
 * 挂载于 conversation.chat.turnTail；AI 生成卡片后渲染，用户可逐项确认/修改后执行。
 */
export function PipelineConfirm(props: {
  cards: PipelineCard[];
  onConfirmAll: () => void;
  onCancel: () => void;
}): ReactNode {
  const [edits, setEdits] = useState<Record<string, string>>({});

  return (
    <PanelCard title="SBAS 全流程参数确认（5 步）">
      {props.cards.map((card) => (
        <div
          key={card.title}
          style={{ borderTop: "1px solid #ddd", padding: "8px 0" }}
        >
          <div style={{ fontWeight: 600, margin: "6px 0" }}>{card.title}</div>
          {card.params.map((p) => (
            <label
              key={p.field}
              style={{ display: "block", fontSize: 12, margin: "2px 0" }}
            >
              {p.label}:
              <input
                type="text"
                defaultValue={edits[p.key] ?? p.recommended}
                onChange={(e) =>
                  setEdits((prev) => ({ ...prev, [p.key]: e.target.value }))
                }
                style={{ marginLeft: 6, width: 90, border: "1px solid #ccc" }}
              />
              <span style={{ color: "#888", marginLeft: 6 }}>
                默认 {p.defaultValue} · 推荐 {p.recommended} · {p.reason}
              </span>
            </label>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <button
          onClick={props.onConfirmAll}
          style={{ marginRight: 8, padding: "4px 12px" }}
        >
          全部确认
        </button>
        <button onClick={props.onCancel} style={{ padding: "4px 12px" }}>
          取消
        </button>
      </div>
    </PanelCard>
  );
}
