import { InMemoryStore } from "../core/store";
import { ActionCommand, Task } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class CreateDefectTaskAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.taskId || !command.taskTitle || !command.assignedRole) {
      throw new Error("CREATE_DEFECT_TASK command is missing required task fields");
    }
    if (!command.actor) {
      throw new Error("CREATE_DEFECT_TASK command is missing actor");
    }
    if (!command.defectId) {
      throw new Error("CREATE_DEFECT_TASK command requires defectId");
    }
    const actor = command.actor;
    if (!canExecuteAction(actor, command, null)) {
      logger.warn("rbac_rejected_action", {
        taskId: command.taskId,
        actionType: command.type,
        status: actor,
      });
      throw new Error("Actor is not authorized to create defect tasks");
    }
    if (store.getTaskInShip(command.taskId, command.shipId)) {
      return;
    }
    const defect = store.getDefect(command.defectId);
    if (!defect) {
      throw new Error(`CREATE_DEFECT_TASK requires existing defect: ${command.defectId}`);
    }
    if (defect.shipId !== command.shipId) {
      throw new Error("CREATE_DEFECT_TASK defect shipId mismatch");
    }

    const task: Task = {
      id: command.taskId,
      shipId: command.shipId,
      parentTaskId: command.parentTaskId ?? null,
      kind: "DEFECT",
      systemGroup: command.systemGroup ?? defect.systemGroup,
      title: command.taskTitle,
      mic: "UNSPECIFIED-MIC",
      iss: defect.iss,
      equipment: defect.equipment,
      cycleCode: "Z",
      scheduleSource: "CYCLE",
      businessDate: command.businessDate,
      dueDate: command.businessDate,
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
      nextDueAt: Date.parse(command.businessDate),
      defectId: command.defectId,
      originDirectiveId: command.originDirectiveId ?? null,
      originRecordId: command.originRecordId ?? null,
      derivedFromType: command.derivedFromType ?? null,
      derivedFromId: command.derivedFromId ?? null,
      ettrDays: command.ettrDays ?? null,
      severity: command.severity ?? "ROUTINE",
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
