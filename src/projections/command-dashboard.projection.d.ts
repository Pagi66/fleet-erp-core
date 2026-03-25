import { ApprovalAwarenessRecord, AssignedRoleId, RoleDashboardSummary } from "../core/types";
export interface CommandDashboardView {
    role: AssignedRoleId;
    summary: {
        pending: number;
        stale: number;
        rejected: number;
        total: number;
    };
    sections: {
        actionRequired: ApprovalAwarenessRecord[];
        needsAttention: ApprovalAwarenessRecord[];
        forAwareness: ApprovalAwarenessRecord[];
    };
}
export declare function buildCommandDashboardView(role: AssignedRoleId, records: ApprovalAwarenessRecord[], summary: RoleDashboardSummary): CommandDashboardView;
//# sourceMappingURL=command-dashboard.projection.d.ts.map