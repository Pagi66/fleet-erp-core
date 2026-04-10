"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startApiServer = startApiServer;
const http_1 = require("http");
const config_1 = require("../core/config");
const logger_1 = require("../core/logger");
function startApiServer(dependencies, port = config_1.config.port) {
    const server = (0, http_1.createServer)(async (request, response) => {
        try {
            await handleApiRequest(request, response, dependencies);
        }
        catch (error) {
            logger_1.logger.error("api_request_failed", error, {
                ...(request.method ? { eventType: request.method } : {}),
                result: request.url ?? "",
                status: "500",
            });
            sendFailure(response, 500, "EXECUTION_ERROR", "Internal Server Error");
        }
    });
    server.listen(port, () => {
        logger_1.logger.stateChange({
            eventType: "HTTP_API_STARTED",
            status: "RUNNING",
            result: `port=${port}`,
        });
    });
    return server;
}
async function handleApiRequest(request, response, dependencies) {
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
        const event = {
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
        }
        catch (error) {
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
            sendFailure(response, 400, "VALIDATION_ERROR", pagination.error);
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
    sendFailure(response, 404, "NOT_FOUND", "Not Found");
}
function sendJson(response, statusCode, body) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
}
function sendSuccess(response, data, options = {}) {
    sendJson(response, 200, {
        success: true,
        ...(typeof data !== "undefined" ? { data } : {}),
        ...(typeof options.duplicate === "boolean" ? { duplicate: options.duplicate } : {}),
        ...(options.meta ? { meta: options.meta } : {}),
    });
}
function sendFailure(response, statusCode, code, message) {
    sendJson(response, statusCode, {
        success: false,
        error: {
            code,
            message,
        },
    });
}
function getShipIdFromPath(pathname, prefix) {
    if (!pathname.startsWith(prefix)) {
        return null;
    }
    const shipId = pathname.slice(prefix.length).trim();
    return shipId === "" ? null : decodeURIComponent(shipId);
}
function getHeaderValue(request, name) {
    const raw = request.headers[name];
    if (typeof raw === "string" && raw.trim() !== "") {
        return raw.trim();
    }
    return null;
}
function readJsonBody(request) {
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
            }
            catch (error) {
                reject(error);
            }
        });
        request.on("error", (error) => {
            reject(error);
        });
    });
}
function validateEventRequest(value) {
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
    const event = {
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
        data: event,
    };
}
function getPagination(url) {
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
function getNumberQueryParam(url, name, fallback) {
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
function paginate(items, limit, offset) {
    return items.slice(offset, offset + limit);
}
function mapExecutionError(error) {
    const message = error instanceof Error ? error.message : "Execution failed";
    if (message.includes("Input guard rejected") ||
        message.includes("No validation rule defined") ||
        message.includes("requires ") ||
        message.includes("is invalid") ||
        message.includes("must be")) {
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
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=api.js.map