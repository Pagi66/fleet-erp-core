import { EngineEvent, TaskSeverity } from "../core/types";
export declare function createDefectReportedEvent(shipId: string, taskId: string, taskTitle: string, businessDate: string, ettrDays: number, severity: TaskSeverity, occurredAt: string): EngineEvent;
export declare function createDefectEvaluationEvent(shipId: string, taskId: string, businessDate: string, occurredAt: string): EngineEvent;
//# sourceMappingURL=defect-events.d.ts.map