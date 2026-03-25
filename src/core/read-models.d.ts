import type { ComplianceSignal } from "./compliance-engine";
import type { Task } from "./types";
export type MeoView = {
    pendingTasks: Task[];
    overdueTasks: Task[];
    complianceWarnings: ComplianceSignal[];
};
export type WeoView = {
    shipId: string;
    totalTasks: number;
    overdueCount: number;
    criticalSignals: ComplianceSignal[];
};
export type CoView = {
    ships: {
        shipId: string;
        overdueCount: number;
        criticalCount: number;
    }[];
};
export interface ReadModelState {
    tasks: Task[];
    compliance: {
        signals: ComplianceSignal[];
    };
}
export declare function getMeoView(state: ReadModelState, shipId: string): MeoView;
export declare function getWeoView(state: ReadModelState, shipId: string): WeoView;
export declare function getCoView(state: ReadModelState): CoView;
export declare function groupTasksByShip(tasks: readonly Task[]): Map<string, Task[]>;
export declare function filterSignalsBySeverity(signals: readonly ComplianceSignal[], severities: readonly ComplianceSignal["severity"][]): ComplianceSignal[];
export declare function countOverdueTasks(tasks: readonly Task[]): number;
//# sourceMappingURL=read-models.d.ts.map