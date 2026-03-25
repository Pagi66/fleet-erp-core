import { AssignedRoleId, TaskSeverity } from "../core/types";
import { EventBus } from "./event-system";
export declare class EngineScheduler {
    private readonly eventBus;
    private readonly getShipIds;
    private readonly tasks;
    private static readonly APPROVAL_STALE_THRESHOLD_HOURS;
    constructor(eventBus: EventBus, getShipIds: () => string[]);
    start(): void;
    stop(): void;
    triggerEndOfDayCheck(shipId: string, businessDate: string, occurredAt?: string): void;
    triggerMorningEscalation(shipId: string, businessDate: string, occurredAt?: string): void;
    triggerPmsTaskGenerate(shipId: string, taskId: string, taskTitle: string, businessDate: string, dueDate: string, assignedRole: AssignedRoleId, occurredAt?: string): void;
    triggerPmsTaskCheck(shipId: string, taskId: string, businessDate: string, occurredAt?: string): void;
    triggerDefectReported(shipId: string, taskId: string, taskTitle: string, businessDate: string, ettrDays: number, severity: TaskSeverity, occurredAt?: string): void;
    triggerDefectEvaluation(shipId: string, taskId: string, businessDate: string, occurredAt?: string): void;
    triggerApprovalStaleCheck(shipId: string, businessDate: string, occurredAt?: string, staleThresholdHours?: number): void;
}
//# sourceMappingURL=scheduler.d.ts.map