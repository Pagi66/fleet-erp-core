import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { CompleteTaskAction } from "../actions/complete-task.action";
import { config } from "../core/config";
import { ComplianceEngine } from "../core/engine";
import { logger } from "../core/logger";
import { ActorContext, AssignedRoleId, EngineEvent, FleetRecordKind, RoleId } from "../core/types";
import { EventBus } from "../events/event-system";
import { InMemoryStore } from "../core/store";

interface HttpAppDependencies {
  engine: ComplianceEngine;
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
  setCorsHeaders(response);
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendSuccess(response, dependencies.getHealthCheck());
    return;
  }

  if (method === "GET" && url.pathname === "/reports/co") {
    sendSuccess(response, dependencies.engine.getCoReport());
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/reports/meo/")) {
    const shipId = getShipIdFromPath(url.pathname, "/reports/meo/");
    if (!shipId) {
      logRejectedRequest(request, "shipId is required");
      sendError(response, 400, "shipId is required");
      return;
    }

    sendSuccess(response, dependencies.engine.getMeoReport(shipId));
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/reports/weo/")) {
    const shipId = getShipIdFromPath(url.pathname, "/reports/weo/");
    if (!shipId) {
      logRejectedRequest(request, "shipId is required");
      sendError(response, 400, "shipId is required");
      return;
    }

    sendSuccess(response, dependencies.engine.getWeoReport(shipId));
    return;
  }

  if (method === "GET" && url.pathname === "/compliance") {
    const pagination = getPagination(url);
    if (!pagination.success) {
      logRejectedRequest(request, pagination.error);
      sendError(response, 400, pagination.error);
      return;
    }

    const allSignals = dependencies.store.getAllComplianceSignals();
    sendSuccess(response, paginate(allSignals, pagination.limit, pagination.offset), {
      meta: {
        limit: pagination.limit,
        offset: pagination.offset,
        total: allSignals.length,
      },
    });
    return;
  }

  if (method === "GET" && url.pathname === "/failed-events") {
    const pagination = getPagination(url);
    if (!pagination.success) {
      logRejectedRequest(request, pagination.error);
      sendError(response, 400, pagination.error);
      return;
    }

    const failedEvents = dependencies.engine.getFailedEvents();
    sendSuccess(response, paginate(failedEvents, pagination.limit, pagination.offset), {
      meta: {
        limit: pagination.limit,
        offset: pagination.offset,
        total: failedEvents.length,
      },
    });
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

  if (method === "GET" && url.pathname === "/records") {
    const role = url.searchParams.get("role");
    if (!role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }
    try {
      const actor = getActorContext(url, role);
      const shipId = actor.shipId;
      if (!shipId) {
        logRejectedRequest(request, "shipId is required");
        sendError(response, 400, "shipId is required");
        return;
      }
      sendSuccess(response, dependencies.store.getApprovalRecordsVisibleToRole(shipId, actor.role));
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid actor context");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid actor context");
    }
    return;
  }

  if (method === "GET" && url.pathname === "/awareness/records/dashboard") {
    const role = url.searchParams.get("role");
    if (!role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }

    try {
      const actor = getActorContext(url, role);
      sendSuccess(response, dependencies.store.getApprovalDashboardSummary(actor, getAwarenessOptions(url)));
      return;
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid awareness query");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid awareness query");
      return;
    }
  }

  if (method === "GET" && url.pathname === "/awareness/records/summary") {
    const role = url.searchParams.get("role");
    if (!role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }

    try {
      const actor = getActorContext(url, role);
      const summary = dependencies.store.getApprovalDashboardSummary(actor, getAwarenessOptions(url));
      sendSuccess(response, {
        role: summary.role,
        ...(summary.shipId ? { shipId: summary.shipId } : {}),
        generatedAt: summary.generatedAt,
        totals: summary.totals,
        countsByStatus: summary.countsByStatus,
        countsByRole: summary.countsByRole,
        countsByShip: summary.countsByShip,
        topActionableRecords: summary.topActionableRecords,
      });
      return;
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid awareness query");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid awareness query");
      return;
    }
  }

  if (method === "GET" && url.pathname === "/awareness/records/visible") {
    const role = url.searchParams.get("role");
    if (!role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }

    try {
      const actor = getActorContext(url, role);
      sendSuccess(response, dependencies.store.getApprovalAwarenessRecords(actor, getAwarenessOptions(url)));
      return;
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid awareness query");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid awareness query");
      return;
    }
  }

  if (method === "GET" && url.pathname === "/awareness/records/owned") {
    const role = url.searchParams.get("role");
    if (!role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }

    try {
      const actor = getActorContext(url, role);
      const records = dependencies.store
        .getApprovalAwarenessRecords(actor, getAwarenessOptions(url))
        .filter((record) => record.bucket === "OWNED" || record.bucket === "PENDING_MY_ACTION");
      sendSuccess(response, records);
      return;
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid awareness query");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid awareness query");
      return;
    }
  }

  if (method === "GET" && url.pathname === "/awareness/records/actionable") {
    const role = url.searchParams.get("role");
    if (!role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }

    try {
      const actor = getActorContext(url, role);
      const limit = getOptionalLimit(url);
      const records = dependencies.store
        .getApprovalAwarenessRecords(actor, getAwarenessOptions(url))
        .filter((record) => record.bucket === "PENDING_MY_ACTION");
      sendSuccess(response, typeof limit === "number" ? records.slice(0, limit) : records);
      return;
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid awareness query");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid awareness query");
      return;
    }
  }

  if (method === "GET" && url.pathname === "/awareness/records/stale") {
    const role = url.searchParams.get("role");
    if (!role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }

    try {
      const actor = getActorContext(url, role);
      const limit = getOptionalLimit(url);
      const records = dependencies.store
        .getApprovalAwarenessRecords(actor, getAwarenessOptions(url))
        .filter((record) => record.computed.isStale)
        .sort((left, right) => {
          const leftAge = left.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
          const rightAge = right.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
          if (leftAge !== rightAge) {
            return rightAge - leftAge;
          }
          return left.createdAt.localeCompare(right.createdAt);
        });
      sendSuccess(response, typeof limit === "number" ? records.slice(0, limit) : records);
      return;
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid awareness query");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid awareness query");
      return;
    }
  }

  if (method === "GET" && url.pathname === "/awareness/records/rejected") {
    const role = url.searchParams.get("role");
    if (!role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "role is required");
      sendError(response, 400, "role is required");
      return;
    }

    try {
      const actor = getActorContext(url, role);
      const limit = getOptionalLimit(url);
      const records = dependencies.store
        .getApprovalAwarenessRecords(actor, getAwarenessOptions(url))
        .filter((record) => record.bucket === "RECENTLY_REJECTED");
      sendSuccess(response, typeof limit === "number" ? records.slice(0, limit) : records);
      return;
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid awareness query");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid awareness query");
      return;
    }
  }

  if (method === "GET" && url.pathname.startsWith("/records/")) {
    const recordId = getRecordIdFromPath(url.pathname);
    const role = url.searchParams.get("role");
    if (!recordId || !role || !isValidAssignedRole(role)) {
      logRejectedRequest(request, "recordId and role are required");
      sendError(response, 400, "recordId and role are required");
      return;
    }
    let recordView;
    try {
      const actor = getActorContext(url, role);
      recordView = dependencies.store.getApprovalRecordViewForActor(recordId, actor);
    } catch (error) {
      logRejectedRequest(request, error instanceof Error ? error.message : "Invalid actor context");
      sendError(response, 400, error instanceof Error ? error.message : "Invalid actor context");
      return;
    }
    if (!recordView.record) {
      logRejectedRequest(request, "Record not found");
      sendError(response, 404, "Record not found");
      return;
    }
    sendSuccess(response, recordView);
    return;
  }

  if (method === "POST" && url.pathname === "/events") {
    const payload = await readJsonBody(request);
    const wrappedValidation = validateWrappedEventPayload(payload);
    if (wrappedValidation.success) {
      const idempotencyKey = getHeaderValue(request, "idempotency-key");
      const event: EngineEvent = {
        ...wrappedValidation.data,
        ...(idempotencyKey ? { id: idempotencyKey } : {}),
      };

      try {
        const processed = dependencies.engine.routeEvent(event);
        sendSuccess(response, undefined, {
          duplicate: !processed,
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Execution failed";
        logRejectedRequest(request, message);
        sendError(response, 400, message);
        return;
      }
    }

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

  if (method === "POST" && url.pathname === "/records") {
    const payload = await readJsonBody(request);
    const actor = extractRole(request, payload);
    if (!actor || actor === "SYSTEM") {
      logRejectedRequest(request, "A non-SYSTEM role is required");
      sendError(response, 400, "A non-SYSTEM role is required");
      return;
    }
    const validation = validateApprovalCreatePayload(payload, actor);
    if (!validation.success) {
      logRejectedRequest(request, validation.error);
      sendError(response, 400, validation.error);
      return;
    }

    dependencies.eventBus.emit(validation.data);
    sendSuccess(response, { accepted: true, recordId: validation.data.recordId });
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

  if (method === "POST" && url.pathname.startsWith("/records/") && isApprovalTransitionPath(url.pathname)) {
    const payload = await readJsonBody(request);
    const actor = extractRole(request, payload);
    if (!actor || actor === "SYSTEM") {
      logRejectedRequest(request, "A non-SYSTEM role is required");
      sendError(response, 400, "A non-SYSTEM role is required");
      return;
    }

    const recordId = getRecordIdFromTransitionPath(url.pathname);
    if (!recordId) {
      logRejectedRequest(request, "Invalid record id");
      sendError(response, 400, "Invalid record id");
      return;
    }

    const validation = validateApprovalTransitionPayload(payload, actor, recordId, url.pathname);
    if (!validation.success) {
      logRejectedRequest(request, validation.error);
      sendError(response, 400, validation.error);
      return;
    }

    dependencies.eventBus.emit(validation.data);
    sendSuccess(response, { accepted: true, recordId });
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

function sendSuccess(
  response: ServerResponse,
  data?: unknown,
  options: {
    duplicate?: boolean;
    meta?: {
      limit: number;
      offset: number;
      total: number;
    };
  } = {},
): void {
  sendJson(response, 200, {
    success: true,
    ...(typeof data !== "undefined" ? { data } : {}),
    ...(typeof options.duplicate === "boolean" ? { duplicate: options.duplicate } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  });
}

function sendError(response: ServerResponse, statusCode: number, error: string): void {
  sendJson(response, statusCode, {
    success: false,
    error,
  });
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Role");
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

function getShipIdFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const shipId = pathname.slice(prefix.length).trim();
  return shipId === "" ? null : decodeURIComponent(shipId);
}

function getHeaderValue(request: IncomingMessage, name: string): string | null {
  const raw = request.headers[name];
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.trim();
  }
  return null;
}

function getPagination(
  url: URL,
): { success: true; limit: number; offset: number } | { success: false; error: string } {
  const limit = getNumberQueryParam(url, "limit", 50);
  if (!limit.success) {
    return limit;
  }

  const offset = getNumberQueryParam(url, "offset", 0);
  if (!offset.success) {
    return offset;
  }

  return {
    success: true,
    limit: limit.value,
    offset: offset.value,
  };
}

function getNumberQueryParam(
  url: URL,
  name: string,
  fallback: number,
): { success: true; value: number } | { success: false; error: string } {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") {
    return { success: true, value: fallback };
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return { success: false, error: `${name} must be a non-negative integer` };
  }

  return { success: true, value };
}

function paginate<T>(items: T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit);
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

function getRecordIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/records\/([^/]+)$/);
  const recordId = match?.[1] ?? null;
  if (!recordId || !/^[A-Za-z0-9_-]+$/.test(recordId)) {
    return null;
  }
  return recordId;
}

function isApprovalTransitionPath(pathname: string): boolean {
  return /^\/records\/[^/]+\/(submit|approve|reject)$/.test(pathname);
}

function getRecordIdFromTransitionPath(pathname: string): string | null {
  const match = pathname.match(/^\/records\/([^/]+)\/(submit|approve|reject)$/);
  const recordId = match?.[1] ?? null;
  if (!recordId || !/^[A-Za-z0-9_-]+$/.test(recordId)) {
    return null;
  }
  return recordId;
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

  if ("recordId" in value && typeof value.recordId !== "undefined") {
    if (typeof value.recordId !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.recordId)) {
      return { success: false, error: "recordId is invalid" };
    }
    baseEvent.recordId = value.recordId;
  }

  if ("recordKind" in value && typeof value.recordKind !== "undefined") {
    if (!isValidRecordKind(value.recordKind)) {
      return { success: false, error: "recordKind is invalid" };
    }
    baseEvent.recordKind = value.recordKind;
  }

  if ("recordTitle" in value && typeof value.recordTitle !== "undefined") {
    if (typeof value.recordTitle !== "string" || value.recordTitle.trim() === "") {
      return { success: false, error: "recordTitle is invalid" };
    }
    baseEvent.recordTitle = value.recordTitle;
  }

  if ("description" in value && typeof value.description !== "undefined") {
    if (typeof value.description !== "string") {
      return { success: false, error: "description is invalid" };
    }
    baseEvent.description = value.description;
  }

  if ("transitionId" in value && typeof value.transitionId !== "undefined") {
    if (typeof value.transitionId !== "string" || value.transitionId.trim() === "") {
      return { success: false, error: "transitionId is invalid" };
    }
    baseEvent.transitionId = value.transitionId;
  }

  if ("reason" in value && typeof value.reason !== "undefined") {
    if (typeof value.reason !== "string") {
      return { success: false, error: "reason is invalid" };
    }
    baseEvent.reason = value.reason;
  }

  if ("note" in value && typeof value.note !== "undefined") {
    if (typeof value.note !== "string") {
      return { success: false, error: "note is invalid" };
    }
    baseEvent.note = value.note;
  }

  if ("staleThresholdHours" in value && typeof value.staleThresholdHours !== "undefined") {
    if (typeof value.staleThresholdHours !== "number" || Number.isNaN(value.staleThresholdHours)) {
      return { success: false, error: "staleThresholdHours is invalid" };
    }
    baseEvent.staleThresholdHours = value.staleThresholdHours;
  }

  const shapeError = validateEventShape(baseEvent);
  if (shapeError) {
    return { success: false, error: shapeError };
  }

  return { success: true, data: baseEvent };
}

function validateWrappedEventPayload(
  value: unknown,
): { success: true; data: EngineEvent } | { success: false; error: string } {
  if (!isRecord(value)) {
    return { success: false, error: "Request body must be an object" };
  }

  if (typeof value.type !== "string" || value.type.trim() === "") {
    return { success: false, error: "type is required" };
  }

  if (!isRecord(value.payload)) {
    return { success: false, error: "payload must be an object" };
  }

  const event: Record<string, unknown> = {
    type: value.type,
    ...value.payload,
  };

  if (typeof event.businessDate !== "string" || event.businessDate.trim() === "") {
    return { success: false, error: "payload.businessDate is required" };
  }

  if (typeof event.occurredAt !== "string" || event.occurredAt.trim() === "") {
    return { success: false, error: "payload.occurredAt is required" };
  }

  return {
    success: true,
    data: event as unknown as EngineEvent,
  };
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
    case "APPROVAL_RECORD_CREATE":
      if (!event.shipId || !event.recordId || !event.recordKind || !event.recordTitle || !event.actor) {
        return "APPROVAL_RECORD_CREATE requires shipId, recordId, recordKind, recordTitle, and actor";
      }
      return null;
    case "APPROVAL_RECORD_SUBMIT":
    case "APPROVAL_RECORD_APPROVE":
    case "APPROVAL_RECORD_REJECT":
      if (!event.shipId || !event.recordId || !event.actor) {
        return `${event.type} requires shipId, recordId, and actor`;
      }
      return null;
    case "APPROVAL_RECORD_STALE_CHECK":
      return event.shipId ? null : "APPROVAL_RECORD_STALE_CHECK requires shipId";
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
    value === "DEFECT_EVALUATION" ||
    value === "APPROVAL_RECORD_CREATE" ||
    value === "APPROVAL_RECORD_SUBMIT" ||
    value === "APPROVAL_RECORD_APPROVE" ||
    value === "APPROVAL_RECORD_REJECT" ||
    value === "APPROVAL_RECORD_STALE_CHECK"
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

function getActorContext(url: URL, role: AssignedRoleId): ActorContext {
  const shipId = getOptionalShipId(url);
  if (
    (role === "MARINE_ENGINEERING_OFFICER" ||
      role === "WEAPON_ELECTRICAL_OFFICER" ||
      role === "COMMANDING_OFFICER") &&
    !shipId
  ) {
    throw new Error(`shipId is required for role ${role}`);
  }

  return {
    role,
    ...(shipId ? { shipId } : {}),
  };
}

function getAwarenessOptions(url: URL): {
  shipId?: string;
  now?: string;
  staleThresholdHours?: number;
  pendingThresholdHours?: number;
  recentlyRejectedWindowHours?: number;
  topActionableLimit?: number;
} {
  const shipId = getOptionalShipId(url);
  const now = url.searchParams.get("now");
  const staleThresholdHours = getOptionalNumber(url, "thresholdHours");
  const pendingThresholdHours = getOptionalNumber(url, "pendingThresholdHours");
  const recentlyRejectedWindowHours = getOptionalNumber(url, "windowHours");
  const topActionableLimit = getOptionalLimit(url);

  return {
    ...(shipId ? { shipId } : {}),
    ...(now ? { now } : {}),
    ...(typeof staleThresholdHours === "number" ? { staleThresholdHours } : {}),
    ...(typeof pendingThresholdHours === "number" ? { pendingThresholdHours } : {}),
    ...(typeof recentlyRejectedWindowHours === "number" ? { recentlyRejectedWindowHours } : {}),
    ...(typeof topActionableLimit === "number" ? { topActionableLimit } : {}),
  };
}

function getOptionalShipId(url: URL): string | undefined {
  const shipId = url.searchParams.get("shipId");
  return shipId && shipId.trim() !== "" ? shipId : undefined;
}

function getOptionalLimit(url: URL): number | undefined {
  return getOptionalNumber(url, "limit");
}

function getOptionalNumber(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }

  return value;
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

function validateApprovalCreatePayload(
  value: unknown,
  actor: Exclude<RoleId, "SYSTEM">,
): { success: true; data: EngineEvent } | { success: false; error: string } {
  if (!isRecord(value)) {
    return { success: false, error: "Approval record payload must be an object" };
  }

  if (typeof value.shipId !== "string" || value.shipId.trim() === "") {
    return { success: false, error: "shipId is required" };
  }

  if (typeof value.recordId !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.recordId)) {
    return { success: false, error: "recordId is invalid" };
  }

  if (!isValidRecordKind(value.recordKind)) {
    return { success: false, error: "recordKind is invalid" };
  }

  if (typeof value.recordTitle !== "string" || value.recordTitle.trim() === "") {
    return { success: false, error: "recordTitle is required" };
  }

  if (typeof value.businessDate !== "string" || value.businessDate.trim() === "") {
    return { success: false, error: "businessDate is required" };
  }

  if (typeof value.occurredAt !== "string" || value.occurredAt.trim() === "") {
    return { success: false, error: "occurredAt is required" };
  }

  if ("description" in value && typeof value.description !== "undefined" && typeof value.description !== "string") {
    return { success: false, error: "description must be a string" };
  }

  const event: EngineEvent = {
    type: "APPROVAL_RECORD_CREATE",
    shipId: value.shipId,
    recordId: value.recordId,
    recordKind: value.recordKind,
    recordTitle: value.recordTitle,
    businessDate: value.businessDate,
    occurredAt: value.occurredAt,
    actor,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
  };

  return { success: true, data: event };
}

function validateApprovalTransitionPayload(
  value: unknown,
  actor: Exclude<RoleId, "SYSTEM">,
  recordId: string,
  pathname: string,
): { success: true; data: EngineEvent } | { success: false; error: string } {
  if (!isRecord(value)) {
    return { success: false, error: "Approval transition payload must be an object" };
  }

  if (typeof value.shipId !== "string" || value.shipId.trim() === "") {
    return { success: false, error: "shipId is required" };
  }

  if (typeof value.businessDate !== "string" || value.businessDate.trim() === "") {
    return { success: false, error: "businessDate is required" };
  }

  if (typeof value.occurredAt !== "string" || value.occurredAt.trim() === "") {
    return { success: false, error: "occurredAt is required" };
  }

  if ("transitionId" in value && typeof value.transitionId !== "undefined" && typeof value.transitionId !== "string") {
    return { success: false, error: "transitionId must be a string" };
  }

  if ("reason" in value && typeof value.reason !== "undefined" && typeof value.reason !== "string") {
    return { success: false, error: "reason must be a string" };
  }

  if ("note" in value && typeof value.note !== "undefined" && typeof value.note !== "string") {
    return { success: false, error: "note must be a string" };
  }

  const action = pathname.endsWith("/submit")
    ? "APPROVAL_RECORD_SUBMIT"
    : pathname.endsWith("/approve")
      ? "APPROVAL_RECORD_APPROVE"
      : "APPROVAL_RECORD_REJECT";

  return {
    success: true,
    data: {
      type: action,
      shipId: value.shipId,
      recordId,
      businessDate: value.businessDate,
      occurredAt: value.occurredAt,
      actor,
      ...(typeof value.transitionId === "string" ? { transitionId: value.transitionId } : {}),
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
      ...(typeof value.note === "string" ? { note: value.note } : {}),
    },
  };
}

function isValidRecordKind(value: unknown): value is FleetRecordKind {
  return value === "MAINTENANCE_LOG" || value === "DEFECT" || value === "WORK_REQUEST";
}
