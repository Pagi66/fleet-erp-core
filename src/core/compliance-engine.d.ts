export type ComplianceSignal = {
    type: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
    shipId?: string;
    taskId?: string;
    defectId?: string;
};
export interface ComplianceTaskState {
    id: string;
    status: "PENDING" | "COMPLETED" | "OVERDUE";
    shipId: string;
    executionStatus?: "PENDING" | "COMPLETED" | "MISSED";
}
export interface ComplianceDefectState {
    id: string;
    shipId: string;
    status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
    ettr?: number;
}
export interface ComplianceEngineState {
    tasks: ComplianceTaskState[];
    defects: ComplianceDefectState[];
}
export declare function evaluateCompliance(state: ComplianceEngineState): ComplianceSignal[];
export declare function evaluateTasks(state: ComplianceEngineState): ComplianceSignal[];
export declare function evaluateDefects(state: ComplianceEngineState): ComplianceSignal[];
export declare function aggregateSignals(...signalGroups: readonly ComplianceSignal[][]): ComplianceSignal[];
//# sourceMappingURL=compliance-engine.d.ts.map