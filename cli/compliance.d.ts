import type { ApprovalAwarenessRecord, DailyComplianceState, FleetRecord, Task } from "../src/core/types";
export type ComplianceLabel = "OVERDUE" | "DUE" | "OK";
export interface ComplianceStatus {
    label: ComplianceLabel;
    priority: number;
    dueAt: string | null;
    hoursUntilDue: number | null;
}
export declare function getComplianceStatus(input: {
    dueAt: string | null;
    completedAt?: string | null;
    now: string;
}): ComplianceStatus;
export declare function getTodayEngineRoomRegisterStatus(input: {
    now: string;
    complianceState: DailyComplianceState;
    records: FleetRecord[];
}): ComplianceStatus;
export declare function getWeeklyReturnStatus(now: string): ComplianceStatus;
export declare function getMonthlyReturnStatus(now: string): ComplianceStatus;
export declare function countOverdueOperationalItems(input: {
    tasks: Task[];
    awarenessRecords: ApprovalAwarenessRecord[];
    weeklyStatus: ComplianceStatus;
    monthlyStatus: ComplianceStatus;
    engineRoomRegisterStatus: ComplianceStatus;
}): number;
//# sourceMappingURL=compliance.d.ts.map