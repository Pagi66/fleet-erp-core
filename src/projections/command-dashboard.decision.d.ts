import { ApprovalAwarenessRecord, AssignedRoleId } from "../core/types";
import { CommandDashboardView } from "./command-dashboard.projection";
export interface ActionBatch {
    key: string;
    records: readonly ApprovalAwarenessRecord[];
    count: number;
}
export interface PatternCluster {
    type: "SHIP" | "REJECTION_REASON" | "RECORD_KIND";
    key: string;
    records: readonly ApprovalAwarenessRecord[];
    count: number;
}
export interface Bottlenecks {
    byRole: Readonly<Record<AssignedRoleId, number>>;
    byShip: Readonly<Record<string, number>>;
}
export interface RejectionInsight {
    reason: string;
    count: number;
}
export declare function getActionBatches(view: CommandDashboardView): readonly ActionBatch[];
export declare function getPatternClusters(view: CommandDashboardView): readonly PatternCluster[];
export declare function getBottlenecks(view: CommandDashboardView): Bottlenecks;
export declare function getNextBestAction(view: CommandDashboardView): ApprovalAwarenessRecord | null;
export declare function getOptimizedActionQueue(view: CommandDashboardView): readonly ApprovalAwarenessRecord[];
export declare function getRejectionInsights(view: CommandDashboardView, minimumCount?: number): readonly RejectionInsight[];
//# sourceMappingURL=command-dashboard.decision.d.ts.map