import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { config } from "../core/config";
import { ComplianceEngine } from "../core/engine";
import { logger } from "../core/logger";
import { InMemoryStore } from "../core/store";
import { EngineEvent } from "../core/types";

interface ApiDependencies {
  engine: ComplianceEngine;
  store: InMemoryStore;
}

type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "DUPLICATE_EVENT"
  | "EXECUTION_ERROR"
  | "NOT_FOUND";

type ApiSuccessBody = {
  success: true;
  data?: unknown;
  duplicate?: boolean;
  meta?: {
    limit: number;
    offset: number;
    total: number;
  };
};

type ApiFailureBody = {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
};

export function startApiServer(
  dependencies: ApiDependencies,
  port = config.port,
): Server {
  const server = createServer(async (request, response) => {
    try {
      await handleApiRequest(request, response, dependencies);
    } catch (error) {
      logger.error("api_request_failed", error, {
        ...(request.method ? { eventType: request.method } : {}),
        result: request.url ?? "",
        status: "500",
      });
      sendFailure(response, 500, "EXECUTION_ERROR", "Internal Server Error");
    }
  });

  server.listen(port, () => {
    logger.stateChange({
      eventType: "HTTP_API_STARTED",
      status: "RUNNING",
      result: `port=${port}`,
    });
  });

  return server;
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: ApiDependencies,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/health") {
    sendSuccess(response, {
      status: "ok",
      timestamp: Date.now(),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/events") {
    const payload = await readJsonBody(request);
    const validation = validateEventRequest(payload);
    if (!validation.success) {
      sendFailure(response, 400, "VALIDATION_ERROR", validation.error);
      return;
    }

    const idempotencyKey = getHeaderValue(request, "idempotency-key");
    const event: EngineEvent = {
      ...validation.data,
      ...(idempotencyKey ? { id: idempotencyKey } : {}),
    };

    try {
      const processed = dependencies.engine.routeEvent(event);
      if (!processed) {
        sendSuccess(response, undefined, {
          duplicate: true,
        });
        return;
      }

      sendSuccess(response);
      return;
    } catch (error) {
      const mapped = mapExecutionError(error);
      sendFailure(response, mapped.statusCode, mapped.code, mapped.message);
      return;
    }
  }

  if (method === "GET" && url.pathname.startsWith("/reports/meo/")) {
    const shipId = getShipIdFromPath(url.pathname, "/reports/meo/");
    if (!shipId) {
      sendFailure(response, 400, "VALIDATION_ERROR", "shipId is required");
      return;
    }

    sendSuccess(response, dependencies.engine.getMeoReport(shipId));
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/reports/weo/")) {
    const shipId = getShipIdFromPath(url.pathname, "/reports/weo/");
    if (!shipId) {
      sendFailure(response, 400, "VALIDATION_ERROR", "shipId is required");
      return;
    }

    sendSuccess(response, dependencies.engine.getWeoReport(shipId));
    return;
  }

  if (method === "GET" && url.pathname === "/reports/co") {
    sendSuccess(response, dependencies.engine.getCoReport());
    return;
  }

  if (method === "GET" && url.pathname === "/compliance") {
    const pagination = getPagination(url);
    if (!pagination.success) {
      sendFailure(response, 400, "VALIDATION_ERROR", pagination.error);
      return;
    }

    const allSignals = dependencies.store.getAllComplianceSignals();
    sendSuccess(
      response,
      paginate(allSignals, pagination.limit, pagination.offset),
      {
        meta: {
          limit: pagination.limit,
          offset: pagination.offset,
          total: allSignals.length,
        },
      },
    );
    return;
  }

  if (method === "GET" && url.pathname === "/failed-events") {
    const pagination = getPagination(url);
    if (!pagination.success) {
      sendFailure(response, 400, "VALIDATION_ERROR", pagination.error);
      return;
    }

    const failedEvents = dependencies.engine.getFailedEvents();
    sendSuccess(
      response,
      paginate(failedEvents, pagination.limit, pagination.offset),
      {
        meta: {
          limit: pagination.limit,
          offset: pagination.offset,
          total: failedEvents.length,
        },
      },
    );
    return;
  }

  sendFailure(response, 404, "NOT_FOUND", "Not Found");
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: ApiSuccessBody | ApiFailureBody,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendSuccess(
  response: ServerResponse,
  data?: unknown,
  options: Pick<ApiSuccessBody, "duplicate" | "meta"> = {},
): void {
  sendJson(response, 200, {
    success: true,
    ...(typeof data !== "undefined" ? { data } : {}),
    ...(typeof options.duplicate === "boolean" ? { duplicate: options.duplicate } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
  });
}

function sendFailure(
  response: ServerResponse,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
): void {
  sendJson(response, statusCode, {
    success: false,
    error: {
      code,
      message,
    },
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

function validateEventRequest(
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

  if ("id" in value && typeof value.id !== "undefined") {
    if (typeof value.id !== "string" || value.id.trim() === "") {
      return { success: false, error: "id must be a non-empty string" };
    }
  }

  const event: Record<string, unknown> = {
    type: value.type,
    ...value.payload,
    ...((typeof value.id === "string" && value.id.trim() !== "") ? { id: value.id.trim() } : {}),
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

function mapExecutionError(error: unknown): {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
} {
  const message = error instanceof Error ? error.message : "Execution failed";

  if (
    message.includes("Input guard rejected") ||
    message.includes("No validation rule defined") ||
    message.includes("requires ") ||
    message.includes("is invalid") ||
    message.includes("must be")
  ) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message,
    };
  }

  return {
    statusCode: 400,
    code: "EXECUTION_ERROR",
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
