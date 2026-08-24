import { type ReactNode } from "react";
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
export declare function PipelineConfirm(props: {
    cards: PipelineCard[];
    onConfirmAll: () => void;
    onCancel: () => void;
}): ReactNode;
