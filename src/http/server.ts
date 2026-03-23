import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { CompleteTaskAction } from "../actions/complete-task.action";
import { config } from "../core/config";
import { logger } from "../core/logger";
import { AssignedRoleId, EngineEvent, RoleId, Task } from "../core/types";
import { EventBus } from "../events/event-system";
import { InMemoryStore } from "../core/store";

interface HttpAppDependencies {
  eventBus: EventBus;
  store: InMemoryStore;
  getHealthCheck: () => ReturnType<InMemoryStore["getHealthCheck"]>;
  completeTaskAction: CompleteTaskAction;
}

export function startHttpServer(
  dependencies: HttpAppDependencies,
  port = config.port,
): Server {
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, dependencies);
    } catch (error) {
      logger.error("http_request_failed", error, {
        ...(request.method ? { eventType: request.method } : {}),
        result: request.url ?? "",
        status: "500",
      });
      sendError(response, 500, "Internal Server Error");
    }
  });

  server.listen(port, () => {
    logger.stateChange({
      eventType: "HTTP_SERVER_STARTED",
      status: "RUNNING",
      result: `port=${port}`,
    });
  });

  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: HttpAppDependencies,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/health") {
    sendSuccess(response, dependencies.getHealthCheck());
    return;
  }

  if (method === "GET" && url.pathname === "/tasks") {
    const shipId = url.searchParams.get("shipId");
    if (!shipId) {
      logRejectedRequest(request, "shipId is required");
      sendError(response, 400, "shipId is required");
      return;
    }
    sendSuccess(response, dependencies.store.getTasksByShip(shipId));
    return;
  }

  if (method === "GET" && url.pathname === "/tasks/overdue") {
    const shipId = url.searchParams.get("shipId");
    if (!shipId) {
      logRejectedRequest(request, "shipId is required");
      sendError(response, 400, "shipId is required");
      return;
    }
    sendSuccess(response, dependencies.store.getOverdueTasksByShip(shipId));
    return;
  }

  if (method === "GET" && url.pathname === "/notifications") {
    const shipId = url.searchParams.get("shipId");
    const role = url.searchParams.get("role");
    if (!shipId) {
      logRejectedRequest(request, "shipId is required");
      sendError(response, 400, "shipId is required");
      return;
    }
    if (!role || !isValidRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }
    sendSuccess(response, dependencies.store.getNotifications(shipId, role));
    return;
  }

  if (method === "POST" && url.pathname === "/events") {
    const payload = await readJsonBody(request);
    const actor = extractRole(request, payload);
    if (!actor) {
      logRejectedRequest(request, "Missing or invalid role");
      sendError(response, 400, "Missing or invalid role");
      return;
    }
    if (actor !== "SYSTEM") {
      logRejectedRequest(request, "Only SYSTEM may submit events");
      sendError(response, 400, "Only SYSTEM may submit events");
      return;
    }
    const validation = validateEventPayload(payload);
    if (!validation.success) {
      logRejectedRequest(request, validation.error);
      sendError(response, 400, validation.error);
      return;
    }

    dependencies.eventBus.emit(validation.data);
    sendSuccess(response, { accepted: true });
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/tasks/") && url.pathname.endsWith("/complete")) {
    const payload = await readJsonBody(request);
    const actor = extractRole(request, payload);
    if (!actor) {
      logRejectedRequest(request, "Missing or invalid role");
      sendError(response, 400, "Missing or invalid role");
      return;
    }

    const taskId = getTaskIdFromPath(url.pathname);
    if (!taskId) {
      logRejectedRequest(request, "Invalid task id");
      sendError(response, 400, "Invalid task id");
      return;
    }

    const task = dependencies.store.getTask(taskId);
    if (!task) {
      logRejectedRequest(request, "Task not found");
      sendError(response, 404, "Task not found");
      return;
    }

    if (task.status === "COMPLETED") {
      logRejectedRequest(request, "Task already completed");
      sendError(response, 400, "Task already completed");
      return;
    }

    const completed = dependencies.completeTaskAction.execute(
      taskId,
      actor,
      dependencies.store,
    );
    sendSuccess(response, completed);
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/notifications/") && url.pathname.endsWith("/read")) {
    const notificationId = getNotificationIdFromPath(url.pathname);
    if (!notificationId) {
      logRejectedRequest(request, "Invalid notification id");
      sendError(response, 400, "Invalid notification id");
      return;
    }

    try {
      const notification = dependencies.store.markNotificationRead(notificationId);
      sendSuccess(response, notification);
      return;
    } catch {
      logRejectedRequest(request, "Notification not found");
      sendError(response, 404, "Notification not found");
      return;
    }
  }

  sendError(response, 404, "Not Found");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendSuccess(response: ServerResponse, data: unknown): void {
  sendJson(response, 200, {
    success: true,
    data,
  });
}

function sendError(response: ServerResponse, statusCode: number, error: string): void {
  sendJson(response, statusCode, {
    success: false,
    error,
  });
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk.toString();
    });

    request.on("end", () => {
      if (raw.trim() === "") {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", (error) => {
      reject(error);
    });
  });
}

function getTaskIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/tasks\/([^/]+)\/complete$/);
  const taskId = match?.[1] ?? null;
  if (!taskId || !/^[A-Za-z0-9_-]+$/.test(taskId)) {
    return null;
  }
  return taskId;
}

function getNotificationIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/notifications\/([^/]+)\/read$/);
  const notificationId = match?.[1] ?? null;
  if (!notificationId || !/^[A-Za-z0-9_-]+$/.test(notificationId)) {
    return null;
  }
  return notificationId;
}

function validateEventPayload(
  value: unknown,
): { success: true; data: EngineEvent } | { success: false; error: string } {
  if (!isRecord(value)) {
    return { success: false, error: "Event payload must be an object" };
  }

  const eventType = value.eventType;
  if (!isValidEventType(eventType)) {
    return { success: false, error: "Unknown or missing eventType" };
  }

  if (typeof value.businessDate !== "string" || value.businessDate.trim() === "") {
    return { success: false, error: "businessDate is required" };
  }

  if (typeof value.occurredAt !== "string" || value.occurredAt.trim() === "") {
    return { success: false, error: "occurredAt is required" };
  }

  if ("shipId" in value && typeof value.shipId !== "undefined") {
    if (typeof value.shipId !== "string" || value.shipId.trim() === "") {
      return { success: false, error: "shipId is invalid" };
    }
  }

  const baseEvent: EngineEvent = {
    type: eventType,
    businessDate: value.businessDate,
    occurredAt: value.occurredAt,
  };

  if ("shipId" in value && typeof value.shipId !== "undefined") {
    const shipId = value.shipId;
    if (typeof shipId !== "string") {
      return { success: false, error: "shipId is invalid" };
    }
    baseEvent.shipId = shipId;
  }

  if ("taskId" in value && typeof value.taskId !== "undefined") {
    if (typeof value.taskId !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.taskId)) {
      return { success: false, error: "taskId is invalid" };
    }
    baseEvent.taskId = value.taskId;
  }

  if ("taskTitle" in value && typeof value.taskTitle !== "undefined") {
    if (typeof value.taskTitle !== "string" || value.taskTitle.trim() === "") {
      return { success: false, error: "taskTitle is invalid" };
    }
    baseEvent.taskTitle = value.taskTitle;
  }

  if ("dueDate" in value && typeof value.dueDate !== "undefined") {
    if (typeof value.dueDate !== "string" || value.dueDate.trim() === "") {
      return { success: false, error: "dueDate is invalid" };
    }
    baseEvent.dueDate = value.dueDate;
  }

  if ("assignedRole" in value && typeof value.assignedRole !== "undefined") {
    if (!isValidAssignedRole(value.assignedRole)) {
      return { success: false, error: "assignedRole is invalid" };
    }
    baseEvent.assignedRole = value.assignedRole;
  }

  if ("taskKind" in value && typeof value.taskKind !== "undefined") {
    if (value.taskKind !== "PMS" && value.taskKind !== "DEFECT") {
      return { success: false, error: "taskKind is invalid" };
    }
    baseEvent.taskKind = value.taskKind;
  }

  if ("ettrDays" in value && typeof value.ettrDays !== "undefined") {
    if (typeof value.ettrDays !== "number" || Number.isNaN(value.ettrDays)) {
      return { success: false, error: "ettrDays is invalid" };
    }
    baseEvent.ettrDays = value.ettrDays;
  }

  if ("severity" in value && typeof value.severity !== "undefined") {
    if (
      value.severity !== "ROUTINE" &&
      value.severity !== "URGENT" &&
      value.severity !== "CRITICAL" &&
      value.severity !== null
    ) {
      return { success: false, error: "severity is invalid" };
    }
    baseEvent.severity = value.severity;
  }

  const shapeError = validateEventShape(baseEvent);
  if (shapeError) {
    return { success: false, error: shapeError };
  }

  return { success: true, data: baseEvent };
}

function validateEventShape(event: EngineEvent): string | null {
  switch (event.type) {
    case "DAILY_LOG_CHECK_DUE":
    case "DAILY_LOG_ESCALATION_DUE":
      return event.shipId ? null : `${event.type} requires shipId`;
    case "PMS_TASK_GENERATE":
      if (!event.shipId || !event.taskId || !event.taskTitle || !event.dueDate || !event.assignedRole) {
        return "PMS_TASK_GENERATE requires shipId, taskId, taskTitle, dueDate, and assignedRole";
      }
      return null;
    case "PMS_TASK_CHECK":
      return event.shipId && event.taskId ? null : "PMS_TASK_CHECK requires shipId and taskId";
    case "DEFECT_REPORTED":
      if (!event.shipId || !event.taskId || !event.taskTitle) {
        return "DEFECT_REPORTED requires shipId, taskId, and taskTitle";
      }
      return null;
    case "DEFECT_EVALUATION":
      return event.shipId && event.taskId ? null : "DEFECT_EVALUATION requires shipId and taskId";
    default:
      return "Unknown eventType";
  }
}

function isValidEventType(value: unknown): value is EngineEvent["type"] {
  return (
    value === "DAILY_LOG_CHECK_DUE" ||
    value === "DAILY_LOG_ESCALATION_DUE" ||
    value === "PMS_TASK_GENERATE" ||
    value === "PMS_TASK_CHECK" ||
    value === "DEFECT_REPORTED" ||
    value === "DEFECT_EVALUATION"
  );
}

function isValidAssignedRole(value: unknown): value is AssignedRoleId {
  return (
    value === "COMMANDING_OFFICER" ||
    value === "MARINE_ENGINEERING_OFFICER" ||
    value === "WEAPON_ELECTRICAL_OFFICER" ||
    value === "FLEET_SUPPORT_GROUP" ||
    value === "LOGISTICS_COMMAND"
  );
}

function isValidRole(value: unknown): value is RoleId {
  return isValidAssignedRole(value) || value === "SYSTEM";
}

function logRejectedRequest(request: IncomingMessage, reason: string): void {
  logger.warn("http_request_rejected", {
    ...(request.method ? { eventType: request.method } : {}),
    result: request.url ?? "",
    status: reason,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractRole(request: IncomingMessage, body: unknown): RoleId | null {
  const headerRole = request.headers["x-role"];
  const candidate =
    typeof headerRole === "string"
      ? headerRole
      : isRecord(body) && "role" in body
        ? body.role
        : null;

  return isValidRole(candidate) ? candidate : null;
}
