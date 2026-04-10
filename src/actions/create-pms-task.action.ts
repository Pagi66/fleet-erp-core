import { InMemoryStore } from "../core/store";
import { ActionCommand, Task } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class CreatePmsTaskAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.taskId || !command.taskTitle || !command.dueDate || !command.assignedRole) {
      throw new Error("CREATE_PMS_TASK command is missing required task fields");
    }
    if (!command.actor) {
      throw new Error("CREATE_PMS_TASK command is missing actor");
    }
    const actor = command.actor;
    if (!canExecuteAction(actor, command, null)) {
      logger.warn("rbac_rejected_action", {
        taskId: command.taskId,
        actionType: command.type,
        status: actor,
      });
      throw new Error("Actor is not authorized to create PMS tasks");
    }
    if (store.getTaskInShip(command.taskId, command.shipId)) {
      return;
    }

    const task: Task = {
      id: command.taskId,
      shipId: command.shipId,
      parentTaskId: command.parentTaskId ?? null,
      kind: "PMS",
      systemGroup: command.systemGroup ?? "GENERAL_ENGINEERING",
      title: command.taskTitle,
      mic: "UNSPECIFIED-MIC",
      iss: "0000",
      equipment: command.taskTitle,
      cycleCode: "D",
      scheduleSource: "CYCLE",
      businessDate: command.businessDate,
      dueDate: command.dueDate,
      assignedRole: command.assignedRole,
      status: "PENDING",
      executionStatus: "PENDING",
      completedAt: null,
      verificationBy: null,
      verificationAt: null,
      lastCheckedAt: null,
      lastOverdueAt: null,
      replannedFromDueDate: null,
      replannedToDueDate: null,
      lastNotifiedAt: null,
      nextDueAt: Date.parse(command.dueDate),
      originDirectiveId: command.originDirectiveId ?? null,
      originRecordId: command.originRecordId ?? null,
      derivedFromType: command.derivedFromType ?? null,
      derivedFromId: command.derivedFromId ?? null,
      ettrDays: null,
      severity: null,
      escalationLevel: "NONE",
      escalatedAt: null,
      sectionVerifiedBy: null,
      sectionVerifiedAt: null,
      departmentVerifiedBy: null,
      departmentVerifiedAt: null,
    };

    store.createTask(task, command.issuedAt, actor);
  }
}
