"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceEngine = void 0;
const compliance_engine_1 = require("./compliance-engine");
const compliance_pressure_1 = require("./compliance-pressure");
const event_integrity_1 = require("./event-integrity");
const input_guard_1 = require("./input-guard");
const config_1 = require("./config");
const logger_1 = require("./logger");
const reporting_1 = require("./reporting");
const ALLOWED_UNGUARDED_EVENT_TYPES = new Set([
    "DAILY_LOG_CHECK_DUE",
    "DAILY_LOG_ESCALATION_DUE",
    "PMS_TASK_GENERATE",
    "PMS_TASK_CHECK",
    "DEFECT_EVALUATION",
    "APPROVAL_RECORD_CREATE",
    "APPROVAL_RECORD_SUBMIT",
    "APPROVAL_RECORD_APPROVE",
    "APPROVAL_RECORD_REJECT",
    "APPROVAL_RECORD_STALE_CHECK",
]);
class ComplianceEngine {
    constructor(dependencies) {
        this.dependencies = dependencies;
        this.lastEventKey = null;
        this.lastEventAtMs = 0;
        this.unsubscribe = this.dependencies.eventBus.subscribe((event) => {
            this.routeEvent(event);
        });
    }
    routeEvent(event) {
        let successfulActionCount = 0;
        try {
            this.assertEventContext(event);
            this.assertInputGuard(event);
            const eventIntegrityId = this.resolveEventIntegrityId(event);
            this.dependencies.store.cleanupProcessedEvents(Date.now(), event_integrity_1.DEFAULT_PROCESSED_EVENT_TTL_MS);
            this.dependencies.store.cleanupFailedEvents(Date.now(), event_integrity_1.DEFAULT_PROCESSED_EVENT_TTL_MS);
            if (this.dependencies.store.isEventProcessed(eventIntegrityId)) {
                logger_1.logger.warn("processed_event_skipped", {
                    eventType: event.type,
                    ...(event.taskId ? { taskId: event.taskId } : {}),
                    status: eventIntegrityId,
                });
                return false;
            }
            if (this.isDuplicateEvent(event)) {
                logger_1.logger.warn("duplicate_event_skipped", {
                    eventType: event.type,
                    ...(event.taskId ? { taskId: event.taskId } : {}),
                    status: "SKIPPED",
                });
                return false;
            }
            logger_1.logger.eventReceived({
                eventType: event.type,
                ...(event.taskId ? { taskId: event.taskId } : {}),
            });
            const decision = this.evaluate(event);
            logger_1.logger.ruleDecision({
                eventType: event.type,
                ...(event.taskId ? { taskId: event.taskId } : {}),
                result: decision.result,
                status: decision.result,
            });
            for (const command of decision.commands) {
                this.assertCommandContext(command, event);
                this.dispatch({
                    ...command,
                    actor: command.actor ?? event.actor ?? "SYSTEM",
                }, event.type);
                successfulActionCount += 1;
            }
            if (decision.commands.length > 0) {
                this.refreshComplianceSignals();
            }
            this.dependencies.store.clearFailedEvent(eventIntegrityId);
            this.dependencies.store.markEventProcessed(eventIntegrityId, Date.now());
            return true;
        }
        catch (error) {
            const eventIntegrityId = this.resolveEventIntegrityId(event);
            const failureReason = error instanceof Error ? error.message : "Unknown event handling failure";
            this.dependencies.store.recordFailedEvent(eventIntegrityId, failureReason, Date.now());
            logger_1.logger.error("event_handling_failed", error, {
                eventType: event.type,
                ...(event.taskId ? { taskId: event.taskId } : {}),
                result: `actions_succeeded=${successfulActionCount}`,
            });
            throw error;
        }
    }
    stop() {
        this.unsubscribe();
    }
    getMeoReport(shipId) {
        return (0, reporting_1.generateMeoReport)(this.buildReadModelState(), shipId);
    }
    getWeoReport(shipId) {
        return (0, reporting_1.generateWeoReport)(this.buildReadModelState(), shipId);
    }
    getCoReport() {
        return (0, reporting_1.generateCoReport)(this.buildReadModelState());
    }
    getFailedEvents() {
        return this.dependencies.store.getFailedEvents();
    }
    dispatch(command, eventType) {
        logger_1.logger.actionExecution({
            eventType,
            ...(command.taskId ? { taskId: command.taskId } : {}),
            actionType: command.type,
            status: "STARTED",
        });
        switch (command.type) {
            case "MARK_COMPLIANT":
            case "MARK_NON_COMPLIANT":
                this.dependencies.markComplianceAction.execute(command, this.dependencies.store);
                break;
            case "NOTIFY_MEO":
                this.dependencies.notifyMeoAction.execute(command, this.dependencies.store);
                break;
            case "ESCALATE_TO_CO":
                this.dependencies.escalateCoAction.execute(command, this.dependencies.store);
                break;
            case "CHECK_TASK":
                this.dependencies.checkTaskAction.execute(command, this.dependencies.store);
                break;
            case "CREATE_DEFECT":
                this.dependencies.createDefectAction.execute(command, this.dependencies.store);
                break;
            case "CREATE_PMS_TASK":
                this.dependencies.createPmsTaskAction.execute(command, this.dependencies.store);
                break;
            case "CREATE_DEFECT_TASK":
                this.dependencies.createDefectTaskAction.execute(command, this.dependencies.store);
                break;
            case "MARK_PMS_TASK_OVERDUE":
                this.dependencies.markPmsTaskOverdueAction.execute(command, this.dependencies.store);
                break;
            case "REPLAN_PMS_TASK":
                this.dependencies.replanPmsTaskAction.execute(command, this.dependencies.store);
                break;
            case "NOTIFY_PMS_SUPERVISOR":
                this.dependencies.notifyPmsSupervisorAction.execute(command, this.dependencies.store);
                break;
            case "ESCALATE_DEFECT_TO_MCC":
                this.dependencies.escalateDefectToMccAction.execute(command, this.dependencies.store);
                break;
            case "ESCALATE_DEFECT_TO_LOG_COMD":
                this.dependencies.escalateDefectToLogComdAction.execute(command, this.dependencies.store);
                break;
            case "AUDIT_APPROVAL_INVALID_ATTEMPT":
                this.dependencies.auditApprovalInvalidAttemptAction.execute(command, this.dependencies.store);
                break;
            case "CREATE_APPROVAL_RECORD":
                this.dependencies.createApprovalRecordAction.execute(command, this.dependencies.store);
                break;
            case "SUBMIT_APPROVAL_RECORD":
                this.dependencies.submitApprovalRecordAction.execute(command, this.dependencies.store);
                break;
            case "APPROVE_APPROVAL_RECORD":
                this.dependencies.approveApprovalRecordAction.execute(command, this.dependencies.store);
                break;
            case "REJECT_APPROVAL_RECORD":
                this.dependencies.rejectApprovalRecordAction.execute(command, this.dependencies.store);
                break;
            case "NOTIFY_APPROVAL_OWNER":
                this.dependencies.notifyApprovalOwnerAction.execute(command, this.dependencies.store);
                break;
            default: {
                const exhaustiveCheck = command.type;
                throw new Error(`Unsupported action command: ${exhaustiveCheck}`);
            }
        }
        logger_1.logger.actionExecution({
            eventType,
            ...(command.taskId ? { taskId: command.taskId } : {}),
            actionType: command.type,
            status: "COMPLETED",
            result: "OK",
        });
    }
    evaluate(event) {
        try {
            switch (event.type) {
                case "DAILY_LOG_CHECK_DUE":
                case "DAILY_LOG_ESCALATION_DUE":
                    return this.dependencies.dailyLogRule.evaluate(event, this.dependencies.store);
                case "PMS_TASK_GENERATE":
                case "PMS_TASK_CHECK":
                    return this.dependencies.pmsTaskRule.evaluate(event, this.dependencies.store);
                case "DEFECT_REPORTED":
                case "DEFECT_EVALUATION":
                    return this.dependencies.defectRule.evaluate(event, this.dependencies.store);
                case "APPROVAL_RECORD_CREATE":
                case "APPROVAL_RECORD_SUBMIT":
                case "APPROVAL_RECORD_APPROVE":
                case "APPROVAL_RECORD_REJECT":
                case "APPROVAL_RECORD_STALE_CHECK":
                    return this.dependencies.approvalRule.evaluate(event, this.dependencies.store);
                default: {
                    const exhaustiveCheck = event.type;
                    throw new Error(`Unsupported engine event: ${exhaustiveCheck}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error("rule_evaluation_failed", error, {
                eventType: event.type,
                ...(event.taskId ? { taskId: event.taskId } : {}),
            });
            throw error;
        }
    }
    assertEventContext(event) {
        const validationError = this.getEventValidationError(event);
        if (!validationError) {
            return;
        }
        logger_1.logger.error("event_context_validation_failed", new Error(validationError), {
            eventType: event.type,
            ...(event.taskId ? { taskId: event.taskId } : {}),
            status: validationError,
        });
        throw new Error(validationError);
    }
    assertInputGuard(event) {
        const guardEvent = this.toInputGuardEvent(event);
        if (!guardEvent) {
            if (ALLOWED_UNGUARDED_EVENT_TYPES.has(event.type)) {
                return;
            }
            logger_1.logger.warn("input_guard_rejected_event", {
                eventType: event.type,
                ...(event.taskId ? { taskId: event.taskId } : {}),
                status: "No validation rule defined for event type",
            });
            throw new Error("No validation rule defined for event type");
        }
        const guardState = this.buildInputGuardState();
        const guardResult = (0, input_guard_1.runInputGuard)(guardEvent, guardState);
        if (guardResult.ok) {
            return;
        }
        logger_1.logger.warn("input_guard_rejected_event", {
            eventType: event.type,
            ...(event.taskId ? { taskId: event.taskId } : {}),
            status: guardResult.reason,
        });
        throw new Error(`Input guard rejected ${event.type}: ${guardResult.reason}`);
    }
    getEventValidationError(event) {
        switch (event.type) {
            case "DAILY_LOG_CHECK_DUE":
            case "DAILY_LOG_ESCALATION_DUE":
                return !event.shipId ? `${event.type} requires shipId` : null;
            case "PMS_TASK_GENERATE":
                return !event.shipId
                    ? "PMS_TASK_GENERATE requires shipId"
                    : !event.taskId
                        ? "PMS_TASK_GENERATE requires taskId"
                        : !event.taskTitle
                            ? "PMS_TASK_GENERATE requires taskTitle"
                            : !event.dueDate
                                ? "PMS_TASK_GENERATE requires dueDate"
                                : !event.assignedRole
                                    ? "PMS_TASK_GENERATE requires assignedRole"
                                    : null;
            case "PMS_TASK_CHECK":
                return !event.shipId
                    ? "PMS_TASK_CHECK requires shipId"
                    : !event.taskId
                        ? "PMS_TASK_CHECK requires taskId"
                        : null;
            case "DEFECT_REPORTED":
                return !event.shipId
                    ? "DEFECT_REPORTED requires shipId"
                    : !event.taskId
                        ? "DEFECT_REPORTED requires taskId"
                        : !event.taskTitle
                            ? "DEFECT_REPORTED requires taskTitle"
                            : null;
            case "DEFECT_EVALUATION":
                return !event.shipId
                    ? "DEFECT_EVALUATION requires shipId"
                    : !event.taskId
                        ? "DEFECT_EVALUATION requires taskId"
                        : null;
            case "APPROVAL_RECORD_CREATE":
                return !event.shipId
                    ? "APPROVAL_RECORD_CREATE requires shipId"
                    : !event.recordId
                        ? "APPROVAL_RECORD_CREATE requires recordId"
                        : !event.recordKind
                            ? "APPROVAL_RECORD_CREATE requires recordKind"
                            : !event.recordTitle
                                ? "APPROVAL_RECORD_CREATE requires recordTitle"
                                : !event.actor
                                    ? "APPROVAL_RECORD_CREATE requires actor"
                                    : null;
            case "APPROVAL_RECORD_SUBMIT":
            case "APPROVAL_RECORD_APPROVE":
            case "APPROVAL_RECORD_REJECT":
                return !event.shipId
                    ? `${event.type} requires shipId`
                    : !event.recordId
                        ? `${event.type} requires recordId`
                        : !event.actor
                            ? `${event.type} requires actor`
                            : null;
            case "APPROVAL_RECORD_STALE_CHECK":
                return !event.shipId ? "APPROVAL_RECORD_STALE_CHECK requires shipId" : null;
            default:
                return null;
        }
    }
    assertCommandContext(command, event) {
        if (!event.shipId) {
            return;
        }
        if (command.shipId && command.shipId !== event.shipId) {
            logger_1.logger.error("command_context_validation_failed", new Error("Command shipId mismatch"), {
                eventType: event.type,
                ...(command.taskId ? { taskId: command.taskId } : {}),
                actionType: command.type,
                status: `${event.shipId}->${command.shipId}`,
            });
            throw new Error(`Command ${command.type} shipId mismatch`);
        }
        if (!command.shipId && command.taskId) {
            logger_1.logger.error("command_context_validation_failed", new Error("Command missing shipId"), {
                eventType: event.type,
                ...(command.taskId ? { taskId: command.taskId } : {}),
                actionType: command.type,
                status: "MISSING_SHIP_ID",
            });
            throw new Error(`Command ${command.type} requires shipId`);
        }
    }
    isDuplicateEvent(event) {
        const eventKey = JSON.stringify({
            type: event.type,
            shipId: event.shipId ?? "GLOBAL",
            taskId: event.taskId ?? null,
            recordId: event.recordId ?? null,
            businessDate: event.businessDate,
            occurredAt: event.occurredAt,
            transitionId: event.transitionId ?? null,
        });
        const now = Date.now();
        const isDuplicate = this.lastEventKey === eventKey &&
            now - this.lastEventAtMs < config_1.config.eventDebounceWindowMs;
        this.lastEventKey = eventKey;
        this.lastEventAtMs = now;
        return isDuplicate;
    }
    refreshComplianceSignals() {
        const tasks = this.dependencies.store.getAllTasks();
        const defects = this.dependencies.store.getAllDefects();
        const complianceSignals = (0, compliance_engine_1.evaluateCompliance)({
            tasks: tasks.map((task) => ({
                id: task.id,
                status: task.status,
                shipId: task.shipId,
                executionStatus: task.executionStatus,
            })),
            defects: defects.map((defect) => ({
                id: defect.id,
                shipId: defect.shipId,
                status: defect.status,
                ...(typeof defect.ettr === "number" ? { ettr: defect.ettr } : {}),
            })),
        });
        const pressureSignals = (0, compliance_pressure_1.evaluatePressure)({
            tasks: tasks.map((task) => ({
                id: task.id,
                shipId: task.shipId,
                status: task.status,
                executionStatus: task.executionStatus,
                ...(task.dueDate ? { dueAt: Date.parse(task.dueDate) } : {}),
                ...(typeof task.nextDueAt === "number" ? { nextDueAt: task.nextDueAt } : {}),
                ...(task.lastOverdueAt ? { overdueSince: Date.parse(task.lastOverdueAt) } : {}),
            })),
            compliance: {
                signals: complianceSignals,
            },
        }, Date.now());
        const mergedSignals = this.mergeSignals(complianceSignals, pressureSignals.map((signal) => ({
            type: signal.type,
            severity: signal.severity,
            message: signal.message,
            ...(signal.shipId ? { shipId: signal.shipId } : {}),
            ...(signal.taskId ? { taskId: signal.taskId } : {}),
        })));
        this.dependencies.store.clearComplianceSignals();
        this.dependencies.store.addComplianceSignals(mergedSignals);
    }
    mergeSignals(...signalGroups) {
        const merged = new Map();
        for (const signal of signalGroups.flat()) {
            merged.set(this.buildSignalKey(signal), signal);
        }
        return [...merged.values()].sort((left, right) => this.compareSignals(left, right));
    }
    buildSignalKey(signal) {
        return [
            signal.type,
            signal.shipId ?? "NO_SHIP",
            signal.taskId ?? "NO_TASK",
            signal.defectId ?? "NO_DEFECT",
        ].join("::");
    }
    compareSignals(left, right) {
        return (this.compareOptionalString(left.shipId, right.shipId) ||
            this.compareSeverity(left.severity, right.severity) ||
            left.type.localeCompare(right.type) ||
            this.compareOptionalString(left.taskId, right.taskId) ||
            this.compareOptionalString(left.defectId, right.defectId) ||
            left.message.localeCompare(right.message));
    }
    compareSeverity(left, right) {
        return this.severityRank(right) - this.severityRank(left);
    }
    severityRank(severity) {
        switch (severity) {
            case "CRITICAL":
                return 3;
            case "WARNING":
                return 2;
            case "INFO":
                return 1;
            default:
                return 0;
        }
    }
    compareOptionalString(left, right) {
        return (left ?? "").localeCompare(right ?? "");
    }
    buildReadModelState() {
        return {
            tasks: this.dependencies.store.getAllTasks(),
            compliance: {
                signals: this.dependencies.store.getAllComplianceSignals(),
            },
        };
    }
    resolveEventIntegrityId(event) {
        if (typeof event.id === "string" && event.id.trim() !== "") {
            return event.id;
        }
        return `${event.type}:${this.serializeDeterministicPayload(this.getDeterministicEventPayload(event))}`;
    }
    toInputGuardEvent(event) {
        switch (event.type) {
            case "DEFECT_REPORTED":
                return {
                    type: "CREATE_DEFECT",
                    ...(event.taskId ? { id: event.taskId } : {}),
                    ...(event.shipId ? { shipId: event.shipId } : {}),
                    ...(event.taskTitle ? { title: event.taskTitle } : {}),
                };
            default:
                return null;
        }
    }
    buildInputGuardState() {
        const tasks = this.dependencies.store.getAllTasks();
        const defects = this.dependencies.store.getAllDefects();
        return {
            defects: defects.map((defect) => ({
                id: defect.id,
                shipId: defect.shipId,
                title: defect.description,
                status: defect.status,
            })),
            tasks: tasks
                .filter((task) => task.kind === "PMS")
                .map((task) => ({
                id: task.id,
                status: task.status,
            })),
        };
    }
    getDeterministicEventPayload(event) {
        const payloadEntries = Object.entries(event)
            .filter(([key, value]) => key !== "id" &&
            key !== "type" &&
            key !== "occurredAt" &&
            typeof value !== "undefined")
            .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
        return Object.fromEntries(payloadEntries.map(([key, value]) => [key, this.normalizeValue(value)]));
    }
    normalizeValue(value) {
        if (Array.isArray(value)) {
            return value.map((item) => this.normalizeValue(item));
        }
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value)
                .filter(([, nestedValue]) => typeof nestedValue !== "undefined")
                .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
                .map(([key, nestedValue]) => [key, this.normalizeValue(nestedValue)]));
        }
        return value;
    }
    serializeDeterministicPayload(payload) {
        return JSON.stringify(payload);
    }
}
exports.ComplianceEngine = ComplianceEngine;
//# sourceMappingURL=engine.js.map