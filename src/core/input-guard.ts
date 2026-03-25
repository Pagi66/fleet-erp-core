export type SupportedInputGuardEventType =
  | "CREATE_DEFECT"
  | "COMPLETE_PMS_TASK";

export interface InputGuardDefectState {
  id: string;
  shipId: string;
  title: string;
  status: string;
}

export interface InputGuardTaskState {
  id: string;
  status: string;
}

export interface InputGuardState {
  defects: InputGuardDefectState[];
  tasks: InputGuardTaskState[];
}

export interface CreateDefectEvent {
  type: "CREATE_DEFECT";
  id?: string;
  shipId?: string;
  title?: string;
}

export interface CompletePmsTaskEvent {
  type: "COMPLETE_PMS_TASK";
  taskId?: string;
}

export type InputGuardEvent = CreateDefectEvent | CompletePmsTaskEvent;

export type InputGuardResult =
  | { ok: true }
  | { ok: false; reason: string };

const REQUIRED_FIELDS: Record<SupportedInputGuardEventType, readonly string[]> = {
  CREATE_DEFECT: ["id", "shipId", "title"],
  COMPLETE_PMS_TASK: ["taskId"],
};

export function validateRequiredFields(event: InputGuardEvent): InputGuardResult {
  const requiredFields = REQUIRED_FIELDS[event.type];

  for (const field of requiredFields) {
    const value = event[field as keyof InputGuardEvent];
    if (typeof value !== "string" || value.trim() === "") {
      return failure(`${event.type} is missing required field: ${field}`);
    }
  }

  return success();
}

export function checkDuplicates(
  event: InputGuardEvent,
  state: InputGuardState,
): InputGuardResult {
  switch (event.type) {
    case "CREATE_DEFECT":
      return checkDuplicateDefect(event, state);
    case "COMPLETE_PMS_TASK":
      return success();
    default:
      return assertNever(event);
  }
}

export function validateState(
  event: InputGuardEvent,
  state: InputGuardState,
): InputGuardResult {
  switch (event.type) {
    case "CREATE_DEFECT":
      return success();
    case "COMPLETE_PMS_TASK":
      return validateCompletePmsTaskState(event, state);
    default:
      return assertNever(event);
  }
}

export function runInputGuard(
  event: InputGuardEvent,
  state: InputGuardState,
): InputGuardResult {
  const requiredFieldsResult = validateRequiredFields(event);
  if (!requiredFieldsResult.ok) {
    return requiredFieldsResult;
  }

  const duplicateResult = checkDuplicates(event, state);
  if (!duplicateResult.ok) {
    return duplicateResult;
  }

  return validateState(event, state);
}

function checkDuplicateDefect(
  event: CreateDefectEvent,
  state: InputGuardState,
): InputGuardResult {
  const shipId = event.shipId?.trim();
  const normalizedTitle = normalizeTitle(event.title);
  if (!shipId || !normalizedTitle) {
    return success();
  }

  const duplicate = state.defects.find(
    (defect) =>
      defect.shipId === shipId &&
      normalizeTitle(defect.title) === normalizedTitle &&
      isActiveDefectStatus(defect.status),
  );

  if (!duplicate) {
    return success();
  }

  return failure(
    `CREATE_DEFECT rejected: active defect already exists for ship ${shipId} with title "${duplicate.title}"`,
  );
}

function validateCompletePmsTaskState(
  event: CompletePmsTaskEvent,
  state: InputGuardState,
): InputGuardResult {
  const taskId = event.taskId?.trim();
  if (!taskId) {
    return success();
  }

  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    return failure(`COMPLETE_PMS_TASK rejected: task not found: ${taskId}`);
  }

  if (isCompletedTaskStatus(task.status)) {
    return failure(
      `COMPLETE_PMS_TASK rejected: task ${taskId} is already completed`,
    );
  }

  return success();
}

function isActiveDefectStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return !(
    normalized === "COMPLETED" ||
    normalized === "CLOSED" ||
    normalized === "RESOLVED" ||
    normalized === "CANCELLED"
  );
}

function isCompletedTaskStatus(status: string): boolean {
  return status.trim().toUpperCase() === "COMPLETED";
}

function normalizeTitle(title: string | undefined): string {
  return typeof title === "string"
    ? title.trim().replace(/\s+/g, " ").toUpperCase()
    : "";
}

function success(): InputGuardResult {
  return { ok: true };
}

function failure(reason: string): InputGuardResult {
  return { ok: false, reason };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled input-guard event: ${JSON.stringify(value)}`);
}
