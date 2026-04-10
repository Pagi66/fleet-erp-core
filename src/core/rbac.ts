import { ActionCommand, FleetRecord, RoleId, Task } from "./types";

export function canExecuteAction(
  actor: RoleId,
  command: ActionCommand,
  task: Task | null,
): boolean {
  if (actor === "SYSTEM") {
    return true;
  }

  switch (command.type) {
    case "CHECK_TASK":
    case "CREATE_DEFECT":
    case "CREATE_PMS_TASK":
    case "CREATE_DEFECT_TASK":
    case "MARK_PMS_TASK_OVERDUE":
    case "REPLAN_PMS_TASK":
    case "NOTIFY_MEO":
    case "NOTIFY_PMS_SUPERVISOR":
    case "ESCALATE_TO_CO":
    case "ESCALATE_DEFECT_TO_MCC":
    case "ESCALATE_DEFECT_TO_LOG_COMD":
    case "MARK_COMPLIANT":
    case "MARK_NON_COMPLIANT":
    case "CREATE_APPROVAL_RECORD":
    case "SUBMIT_APPROVAL_RECORD":
    case "APPROVE_APPROVAL_RECORD":
    case "REJECT_APPROVAL_RECORD":
    case "NOTIFY_APPROVAL_OWNER":
    case "AUDIT_APPROVAL_INVALID_ATTEMPT":
      return false;
    default:
      return taskCompletionAllowed(actor, task);
  }
}

export function canCompleteTask(actor: RoleId, task: Task): boolean {
  return taskCompletionAllowed(actor, task);
}

function taskCompletionAllowed(actor: RoleId, task: Task | null): boolean {
  if (!task) {
    return false;
  }

  if (actor === "COMMANDING_OFFICER") {
    return false;
  }

  if (actor !== task.assignedRole) {
    return false;
  }

  switch (actor) {
    case "MARINE_ENGINEERING_OFFICER":
    case "WEAPON_ELECTRICAL_OFFICER":
    case "FLEET_SUPPORT_GROUP":
    case "LOGISTICS_COMMAND":
      return true;
    default:
      return false;
  }
}

export function canManageApprovalRecord(
  actor: RoleId,
  command: ActionCommand,
  record: FleetRecord | null,
): boolean {
  if (actor === "SYSTEM") {
    return true;
  }

  switch (command.type) {
    case "CREATE_APPROVAL_RECORD":
      return (
        command.originRole === actor &&
        (
          actor === "MARINE_ENGINEERING_OFFICER" ||
          actor === "WEAPON_ELECTRICAL_OFFICER" ||
          actor === "FLEET_SUPPORT_GROUP" ||
          actor === "LOGISTICS_COMMAND" ||
          actor === "COMMANDING_OFFICER"
        )
      );
    case "SUBMIT_APPROVAL_RECORD":
      return (
        record !== null &&
        record.approval.status === "DRAFT" &&
        record.approval.currentOwner === actor
      );
    case "APPROVE_APPROVAL_RECORD":
    case "REJECT_APPROVAL_RECORD":
      return (
        record !== null &&
        record.approval.status === "SUBMITTED" &&
        record.approval.currentOwner === actor
      );
    case "NOTIFY_APPROVAL_OWNER":
      return false;
    default:
      return false;
  }
}
