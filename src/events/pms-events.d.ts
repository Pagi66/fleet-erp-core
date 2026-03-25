import { AssignedRoleId, EngineEvent } from "../core/types";
export declare function createPmsTaskGenerateEvent(shipId: string, taskId: string, taskTitle: string, businessDate: string, dueDate: string, assignedRole: AssignedRoleId, occurredAt: string): EngineEvent;
export declare function createPmsTaskCheckEvent(shipId: string, taskId: string, businessDate: string, occurredAt: string): EngineEvent;
//# sourceMappingURL=pms-events.d.ts.map