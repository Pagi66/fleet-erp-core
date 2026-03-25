import { ActionCommand, FleetRecord, RoleId, Task } from "./types";
export declare function canExecuteAction(actor: RoleId, command: ActionCommand, task: Task | null): boolean;
export declare function canCompleteTask(actor: RoleId, task: Task): boolean;
export declare function canManageApprovalRecord(actor: RoleId, command: ActionCommand, record: FleetRecord | null): boolean;
//# sourceMappingURL=rbac.d.ts.map