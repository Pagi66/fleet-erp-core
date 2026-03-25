import { ApprovalAwarenessRecord, AttentionSignal, AssignedRoleId } from "../core/types";
import { CommandDashboardView } from "./command-dashboard.projection";
export type SectionKey = "ACTION_REQUIRED" | "NEEDS_ATTENTION" | "FOR_AWARENESS";
export interface CommandDashboardCardView {
    recordId: string;
    title: string;
    ship: {
        id: string;
        name: string;
        classType: string;
    };
    status: ApprovalAwarenessRecord["status"];
    currentOwner: AssignedRoleId;
    ageHoursSinceLastAction: number | null;
    reason: string | null;
    note: string | null;
    attentionSignals: readonly AttentionSignal[];
}
export interface CommandDashboardSectionState {
    id: SectionKey;
    expanded: boolean;
    minimized: boolean;
    recordIds: readonly string[];
}
export interface CommandDashboardInteractionState {
    readonly sectionOrder: readonly SectionKey[];
    readonly activeSection: SectionKey;
    readonly selectedRecordId: string | null;
    readonly scrollPosition: number;
    readonly sections: Readonly<Record<SectionKey, CommandDashboardSectionState>>;
}
export interface CommandDashboardPreviousState {
    activeSection: SectionKey;
    selectedRecordId: string | null;
    scrollPosition: number;
    sectionRecordIds?: Readonly<Record<SectionKey, readonly string[]>>;
}
export interface RejectionFocus {
    recordId: string;
    status: ApprovalAwarenessRecord["status"];
    reason: string;
    note: string | null;
}
export declare function getInitialDashboardState(view: CommandDashboardView): CommandDashboardInteractionState;
export declare function getActionQueue(role: AssignedRoleId, view: CommandDashboardView): readonly ApprovalAwarenessRecord[];
export declare function computeAttentionPriority(record: ApprovalAwarenessRecord): number;
export declare function getRejectionFocus(record: ApprovalAwarenessRecord): RejectionFocus;
export declare function restoreDashboardState(previousState: CommandDashboardPreviousState, view: CommandDashboardView): CommandDashboardInteractionState;
export declare function toCommandDashboardCardView(record: ApprovalAwarenessRecord): CommandDashboardCardView;
export declare function compareRecordsByInteractionPriority(left: ApprovalAwarenessRecord, right: ApprovalAwarenessRecord): number;
//# sourceMappingURL=command-dashboard.interaction.d.ts.map