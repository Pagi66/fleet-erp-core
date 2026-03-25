import { type ReadModelState } from "./read-models";
export type OperationalStatus = "STABLE" | "ATTENTION" | "CRITICAL";
export type MeoReport = {
    shipId: string;
    pendingCount: number;
    overdueCount: number;
    warningCount: number;
    criticalCount: number;
};
export type WeoReport = {
    shipId: string;
    totalTasks: number;
    overdueCount: number;
    criticalCount: number;
    status: OperationalStatus;
};
export type CoReport = {
    ships: {
        shipId: string;
        overdueCount: number;
        criticalCount: number;
        status: OperationalStatus;
    }[];
};
export declare function generateMeoReport(state: ReadModelState, shipId: string): MeoReport;
export declare function generateWeoReport(state: ReadModelState, shipId: string): WeoReport;
export declare function generateCoReport(state: ReadModelState): CoReport;
export declare function computeStatus(overdueCount: number, criticalCount: number): OperationalStatus;
//# sourceMappingURL=reporting.d.ts.map