import type { ComplianceSignal } from "./compliance-engine";
export type PressureSignal = {
    type: string;
    severity: "WARNING" | "CRITICAL";
    message: string;
    shipId?: string;
    taskId?: string;
};
export interface PressureTaskState {
    id: string;
    shipId: string;
    status: "PENDING" | "COMPLETED" | "OVERDUE";
    dueAt?: number;
    overdueSince?: number;
}
export interface CompliancePressureState {
    tasks: PressureTaskState[];
    compliance: {
        signals: ComplianceSignal[];
    };
}
export declare function evaluatePressure(state: CompliancePressureState, now: number): PressureSignal[];
export declare function computeOverdueDuration(task: PressureTaskState, now: number): number | null;
export declare function evaluateOverdueSeverity(overdueDurationMs: number | null): PressureSignal["severity"];
export declare function aggregateShipPressure(tasks: readonly PressureTaskState[]): PressureSignal[];
//# sourceMappingURL=compliance-pressure.d.ts.map