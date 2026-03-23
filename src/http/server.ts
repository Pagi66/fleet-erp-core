import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { logger } from "../core/logger";
import { EngineEvent, Task } from "../core/types";
import { EventBus } from "../events/event-system";
import { InMemoryStore } from "../core/store";

interface HttpAppDependencies {
  eventBus: EventBus;
  store: InMemoryStore;
  getHealthCheck: () => ReturnType<InMemoryStore["getHealthCheck"]>;
}

export function startHttpServer(
  dependencies: HttpAppDependencies,
  port = Number(process.env.PORT ?? 3000),
): Server {
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, dependencies);
    } catch (error) {
      logger.error("http_request_failed", error, {
        eventType: request.method,
        result: request.url ?? "",
        status: "500",
      });
      sendJson(response, 500, { error: "Internal Server Error" });
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
    sendJson(response, 200, dependencies.getHealthCheck());
    return;
  }

  if (method === "GET" && url.pathname === "/tasks") {
    sendJson(response, 200, dependencies.store.getAllTasks());
    return;
  }

  if (method === "GET" && url.pathname === "/tasks/overdue") {
    sendJson(response, 200, dependencies.store.getOverdueTasks());
    return;
  }

  if (method === "POST" && url.pathname === "/events") {
    const payload = await readJsonBody(request);
    if (!isEngineEvent(payload)) {
      sendJson(response, 400, { error: "Invalid event payload" });
      return;
    }

    dependencies.eventBus.emit(payload);
    sendJson(response, 202, { accepted: true });
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/tasks/") && url.pathname.endsWith("/complete")) {
    const taskId = getTaskIdFromPath(url.pathname);
    if (!taskId) {
      sendJson(response, 400, { error: "Invalid task id" });
      return;
    }

    const task = dependencies.store.getTask(taskId);
    if (!task) {
      sendJson(response, 404, { error: "Task not found" });
      return;
    }

    const completed = dependencies.store.completeTask(taskId, new Date().toISOString());
    sendJson(response, 200, completed);
    return;
  }

  sendJson(response, 404, { error: "Not Found" });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
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
  return match?.[1] ?? null;
}

function isEngineEvent(value: unknown): value is EngineEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.type === "string" &&
    typeof value.businessDate === "string" &&
    typeof value.occurredAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
