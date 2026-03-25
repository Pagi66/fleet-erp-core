"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryStore = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("./config");
const event_integrity_1 = require("./event-integrity");
const logger_1 = require("./logger");
const types_1 = require("./types");
const STORE_STATE_VERSION = 10;
const DEFAULT_AWARENESS_STALE_THRESHOLD_HOURS = 24;
const DEFAULT_AWARENESS_PENDING_THRESHOLD_HOURS = 48;
const DEFAULT_AWARENESS_REJECTED_WINDOW_HOURS = 72;
const DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT = 5;
class InMemoryStore {
    constructor(persistenceFilePath = config_1.config.persistenceFilePath) {
        this.shipsById = new Map();
        this.logsByDate = new Map();
        this.complianceByDate = new Map();
        this.escalationByDate = new Map();
        this.tasksById = new Map();
        this.taskHistoryById = new Map();
        this.recordsById = new Map();
        this.approvalHistoryById = new Map();
        this.processedTransitions = new Map();
        this.processedEventsById = new Map();
        this.notificationsById = new Map();
        this.complianceSignalsByKey = new Map();
        this.lastPersistenceTimestamp = null;
        this.persistenceFilePath = persistenceFilePath;
        this.backupFilePath = `${persistenceFilePath}.bak`;
        this.tempFilePath = `${persistenceFilePath}.tmp`;
        this.loadPersistedState();
    }
    saveLog(record) {
        this.assertValidShipId(record.shipId);
        this.assertShipExists(record.shipId);
        const stateKey = this.getDailyStateKey(record.shipId, record.businessDate);
        const existing = this.logsByDate.get(stateKey) ?? [];
        const withoutSameType = existing.filter((entry) => entry.logType !== record.logType);
        withoutSameType.push(record);
        this.logsByDate.set(stateKey, withoutSameType);
        logger_1.logger.stateChange({
            eventType: "LOG_RECORDED",
            status: "UPDATED",
        });
    }
    getLogsForDate(shipId, businessDate) {
        const stateKey = this.getDailyStateKey(shipId, businessDate);
        return [...(this.logsByDate.get(stateKey) ?? [])];
    }
    getOrCreateComplianceState(shipId, businessDate) {
        const stateKey = this.getDailyStateKey(shipId, businessDate);
        const existing = this.complianceByDate.get(stateKey);
        if (existing) {
            return existing;
        }
        const initialState = {
            shipId,
            businessDate,
            requiredLogs: [...types_1.REQUIRED_DAILY_LOGS],
            presentLogs: [],
            missingLogs: [...types_1.REQUIRED_DAILY_LOGS],
            status: "PENDING",
            lastEvaluatedAt: null,
            meoNotifiedAt: null,
        };
        this.complianceByDate.set(stateKey, initialState);
        return initialState;
    }
    updateComplianceState(shipId, businessDate, update) {
        const stateKey = this.getDailyStateKey(shipId, businessDate);
        const current = this.getOrCreateComplianceState(shipId, businessDate);
        const next = {
            ...current,
            ...update,
        };
        this.complianceByDate.set(stateKey, next);
        logger_1.logger.stateChange({
            eventType: "COMPLIANCE_STATE_UPDATED",
            status: next.status,
        });
        return next;
    }
    getOrCreateEscalationState(shipId, businessDate) {
        const stateKey = this.getDailyStateKey(shipId, businessDate);
        const existing = this.escalationByDate.get(stateKey);
        if (existing) {
            return existing;
        }
        const initialState = {
            shipId,
            businessDate,
            status: "NOT_ESCALATED",
            reason: null,
            missingLogsAtEscalation: [],
            escalatedAt: null,
            targetRole: null,
        };
        this.escalationByDate.set(stateKey, initialState);
        return initialState;
    }
    updateEscalationState(shipId, businessDate, update) {
        const stateKey = this.getDailyStateKey(shipId, businessDate);
        const current = this.getOrCreateEscalationState(shipId, businessDate);
        const next = {
            ...current,
            ...update,
        };
        this.escalationByDate.set(stateKey, next);
        logger_1.logger.stateChange({
            eventType: "ESCALATION_STATE_UPDATED",
            status: next.status,
        });
        this.persistState();
        return next;
    }
    getSnapshot(shipId, businessDate) {
        return {
            logs: this.getLogsForDate(shipId, businessDate),
            complianceState: this.getOrCreateComplianceState(shipId, businessDate),
            escalationState: this.getOrCreateEscalationState(shipId, businessDate),
        };
    }
    createTask(task, occurredAt, actor) {
        this.assertValidShipId(task.shipId);
        this.assertShipExists(task.shipId);
        this.assertValidAssignedRole(task.assignedRole, "assignedRole");
        this.assertValidRole(actor, "actor");
        const existing = this.getTask(task.id);
        if (existing) {
            if (existing.shipId !== task.shipId) {
                logger_1.logger.error("cross_ship_task_id_conflict", new Error("Task ID already used by another ship"), {
                    taskId: task.id,
                    status: `${existing.shipId}->${task.shipId}`,
                });
                throw new Error(`Task ID already exists in another ship: ${task.id}`);
            }
            return existing;
        }
        this.tasksById.set(task.id, task);
        const state = this.createStateSnapshot(task);
        this.appendTaskHistory(task.id, task.shipId, "CREATED", state, state, occurredAt, actor);
        logger_1.logger.stateChange({
            taskId: task.id,
            actionType: "CREATED",
            status: task.status,
        });
        this.persistState();
        return task;
    }
    getTask(taskId) {
        return this.tasksById.get(taskId) ?? null;
    }
    getTaskInShip(taskId, shipId) {
        this.assertValidShipId(shipId);
        const task = this.getTask(taskId);
        if (!task || task.shipId !== shipId) {
            return null;
        }
        return task;
    }
    completeTask(taskId, occurredAt, actor) {
        this.assertValidRole(actor, "actor");
        const current = this.requireTask(taskId);
        if (current.status === "COMPLETED") {
            return current;
        }
        this.assertTaskStatusTransition(current.status, "COMPLETED");
        return this.applyTaskUpdate(taskId, {
            status: "COMPLETED",
            completedAt: occurredAt,
            lastCheckedAt: occurredAt,
        }, "COMPLETED", occurredAt, actor);
    }
    recordTaskCheck(taskId, occurredAt, actor) {
        this.assertValidRole(actor, "actor");
        const current = this.requireTask(taskId);
        if (current.lastCheckedAt === occurredAt) {
            return current;
        }
        return this.applyTaskUpdate(taskId, {
            lastCheckedAt: occurredAt,
        }, "CHECKED", occurredAt, actor);
    }
    markTaskOverdue(taskId, occurredAt, actor) {
        this.assertValidRole(actor, "actor");
        const current = this.requireTask(taskId);
        if (current.status === "COMPLETED" || current.status === "OVERDUE") {
            return current;
        }
        this.assertTaskStatusTransition(current.status, "OVERDUE");
        return this.applyTaskUpdate(taskId, {
            status: "OVERDUE",
            lastCheckedAt: occurredAt,
            lastOverdueAt: occurredAt,
        }, "STATUS_CHANGED", occurredAt, actor);
    }
    escalateTask(taskId, escalationLevel, occurredAt, actor) {
        this.assertValidRole(actor, "actor");
        const current = this.requireTask(taskId);
        if (current.escalationLevel === escalationLevel) {
            return current;
        }
        this.assertEscalationTransition(current.escalationLevel, escalationLevel);
        return this.applyTaskUpdate(taskId, {
            escalationLevel,
            escalatedAt: occurredAt,
            lastNotifiedAt: occurredAt,
        }, "ESCALATED", occurredAt, actor);
    }
    replanTask(taskId, nextDueDate, occurredAt, actor) {
        this.assertValidRole(actor, "actor");
        const current = this.requireTask(taskId);
        if (current.dueDate === nextDueDate) {
            return current;
        }
        return this.applyTaskUpdate(taskId, {
            dueDate: nextDueDate,
            parentTaskId: current.parentTaskId ?? current.id,
            replannedFromDueDate: current.dueDate,
            replannedToDueDate: nextDueDate,
        }, "REPLANNED", occurredAt, actor);
    }
    recordTaskNotification(taskId, occurredAt, actor) {
        this.assertValidRole(actor, "actor");
        const current = this.requireTask(taskId);
        if (current.lastNotifiedAt !== null &&
            (current.lastOverdueAt === null || current.lastNotifiedAt >= current.lastOverdueAt)) {
            return current;
        }
        return this.applyTaskUpdate(taskId, {
            lastNotifiedAt: occurredAt,
        }, "NOTIFIED", occurredAt, actor);
    }
    getTaskSnapshot(taskId) {
        return {
            task: this.getTask(taskId),
            history: [...(this.taskHistoryById.get(taskId) ?? [])],
        };
    }
    getTaskSnapshotInShip(taskId, shipId) {
        const task = this.getTaskInShip(taskId, shipId);
        return {
            task,
            history: task ? [...(this.taskHistoryById.get(taskId) ?? [])] : [],
        };
    }
    createApprovalRecord(record, occurredAt, actor) {
        this.assertValidShipId(record.shipId);
        this.assertShipExists(record.shipId);
        this.assertValidFleetRecord(record);
        this.assertValidRole(actor, "actor");
        const existing = this.getApprovalRecord(record.id);
        if (existing) {
            if (existing.shipId !== record.shipId) {
                logger_1.logger.error("cross_ship_record_id_conflict", new Error("Record ID already used by another ship"), {
                    status: `${existing.shipId}->${record.shipId}`,
                });
                throw new Error(`Record ID already exists in another ship: ${record.id}`);
            }
            return existing;
        }
        this.recordsById.set(record.id, record);
        const state = this.createApprovalSnapshot(record);
        this.appendApprovalHistory(record.id, record.shipId, "CREATED", state, state, occurredAt, actor, null, null, null);
        this.persistState();
        return record;
    }
    getApprovalRecord(recordId) {
        return this.recordsById.get(recordId) ?? null;
    }
    getApprovalRecordInShip(recordId, shipId) {
        this.assertValidShipId(shipId);
        const record = this.getApprovalRecord(recordId);
        if (!record || record.shipId !== shipId) {
            return null;
        }
        return record;
    }
    getApprovalRecordViewInShip(recordId, shipId) {
        const record = this.getApprovalRecordInShip(recordId, shipId);
        return {
            record,
            history: record ? [...(this.approvalHistoryById.get(recordId) ?? [])] : [],
        };
    }
    getProcessedApprovalTransition(transitionId) {
        return this.processedTransitions.get(transitionId) ?? null;
    }
    isEventProcessed(eventId) {
        return (0, event_integrity_1.isDuplicateEvent)(eventId, this.getEventIntegrityState());
    }
    markEventProcessed(eventId, processedAt) {
        const nextState = (0, event_integrity_1.markEventProcessed)(eventId, this.getEventIntegrityState(), processedAt);
        this.replaceProcessedEvents(nextState.processedEvents);
        this.persistState();
    }
    cleanupProcessedEvents(now, ttlMs) {
        const nextState = (0, event_integrity_1.cleanupOldEvents)(this.getEventIntegrityState(), now, ttlMs);
        this.replaceProcessedEvents(nextState.processedEvents);
        this.persistState();
    }
    getPreviousApprovalOwnerInShip(recordId, shipId) {
        const record = this.getApprovalRecordInShip(recordId, shipId);
        if (!record) {
            throw new Error("Approval record does not exist in the provided ship context");
        }
        return this.getPreviousApprovalOwner(recordId, record);
    }
    getApprovalRecordsByShip(shipId) {
        this.assertValidShipId(shipId);
        return [...this.recordsById.values()].filter((record) => record.shipId === shipId);
    }
    getApprovalRecordsVisibleToRole(shipId, role) {
        this.assertValidShipId(shipId);
        this.assertValidAssignedRole(role, "role");
        return this.getApprovalRecordsByShip(shipId).filter((record) => record.visibleTo.includes(role));
    }
    getApprovalRecordViewVisibleToRole(recordId, shipId, role) {
        this.assertValidAssignedRole(role, "role");
        const view = this.getApprovalRecordViewInShip(recordId, shipId);
        if (!view.record || !view.record.visibleTo.includes(role)) {
            return {
                record: null,
                history: [],
            };
        }
        return view;
    }
    getApprovalRecordViewForActor(recordId, actor) {
        const normalizedActor = this.normalizeActorContext(actor);
        const record = this.getApprovalRecord(recordId);
        if (!record) {
            return {
                record: null,
                history: [],
            };
        }
        if (!this.isRecordVisibleToActor(record, normalizedActor)) {
            return {
                record: null,
                history: [],
            };
        }
        return {
            record,
            history: [...(this.approvalHistoryById.get(recordId) ?? [])],
        };
    }
    getApprovalAwarenessRecords(actor, options = {}) {
        const normalizedActor = this.normalizeActorContext(actor);
        const normalized = this.normalizeAwarenessOptions(options);
        const visibleRecords = this.getVisibleApprovalRecordsForAwareness(normalizedActor, normalized);
        const projected = visibleRecords.map((record) => this.projectApprovalAwarenessRecord(record, normalizedActor.role, normalized));
        const sorted = projected.sort((left, right) => this.compareAwarenessRecords(left, right));
        this.assertApprovalAwarenessRecords(normalizedActor, sorted);
        return sorted;
    }
    getApprovalDashboardSummary(actor, options = {}) {
        const normalizedActor = this.normalizeActorContext(actor);
        const normalized = this.normalizeAwarenessOptions(options);
        const records = this.getApprovalAwarenessRecords(normalizedActor, normalized);
        const scopedShipId = this.resolveActorScopedShipId(normalizedActor, normalized);
        const countsByStatus = {
            DRAFT: 0,
            SUBMITTED: 0,
            APPROVED: 0,
            REJECTED: 0,
        };
        const countsByRole = {
            COMMANDING_OFFICER: 0,
            MARINE_ENGINEERING_OFFICER: 0,
            WEAPON_ELECTRICAL_OFFICER: 0,
            FLEET_SUPPORT_GROUP: 0,
            LOGISTICS_COMMAND: 0,
        };
        const countsByShip = {};
        for (const record of records) {
            countsByStatus[record.status] += 1;
            countsByRole[record.currentOwner] += 1;
            countsByShip[record.shipId] = (countsByShip[record.shipId] ?? 0) + 1;
        }
        const summary = {
            role: normalizedActor.role,
            ...(scopedShipId ? { shipId: scopedShipId } : {}),
            generatedAt: normalized.now,
            totals: {
                visible: records.length,
                owned: records.filter((record) => record.bucket === "OWNED").length,
                needingMyAction: records.filter((record) => record.bucket === "PENDING_MY_ACTION").length,
                recentlyRejected: records.filter((record) => record.bucket === "RECENTLY_REJECTED").length,
                visibleNotOwned: records.filter((record) => record.bucket === "VISIBLE_NOT_OWNED").length,
                stale: records.filter((record) => record.computed.isStale).length,
                blockedByRejection: records.filter((record) => record.attentionSignals.includes("BLOCKED_BY_REJECTION")).length,
                pendingTooLong: records.filter((record) => record.computed.isPendingTooLong).length,
            },
            countsByStatus,
            countsByRole,
            countsByShip,
            topActionableRecords: records
                .filter((record) => record.bucket === "PENDING_MY_ACTION")
                .slice(0, normalized.topActionableLimit),
            records,
        };
        this.assertApprovalAwarenessSummary(summary, normalizedActor);
        return summary;
    }
    getTopActionableRecords(actor, limit = DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT) {
        const records = this.getApprovalAwarenessRecords(actor, {
            topActionableLimit: limit,
        });
        return records
            .filter((record) => record.bucket === "PENDING_MY_ACTION")
            .slice(0, limit);
    }
    getTopStaleRecords(actor, limit = DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT) {
        const records = this.getApprovalAwarenessRecords(actor, {
            topActionableLimit: limit,
        });
        return [...records]
            .filter((record) => record.computed.isStale)
            .sort((left, right) => this.compareByAgeThenCreatedAt(left, right))
            .slice(0, limit);
    }
    getRecentRejections(actor, limit = DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT) {
        const records = this.getApprovalAwarenessRecords(actor, {
            topActionableLimit: limit,
        });
        return records
            .filter((record) => record.bucket === "RECENTLY_REJECTED")
            .slice(0, limit);
    }
    getStaleApprovalRecordsByShip(shipId, occurredAt, thresholdHours) {
        this.assertValidShipId(shipId);
        if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
            throw new Error("thresholdHours must be a positive number");
        }
        const thresholdMs = thresholdHours * 60 * 60 * 1000;
        const nowMs = new Date(occurredAt).getTime();
        if (Number.isNaN(nowMs)) {
            throw new Error(`Invalid occurredAt timestamp: ${occurredAt}`);
        }
        return this.getApprovalRecordsByShip(shipId).filter((record) => {
            if (record.approval.status === "APPROVED" || record.approval.status === "REJECTED") {
                return false;
            }
            const lastActionMs = record.approval.lastActionAt ? new Date(record.approval.lastActionAt).getTime() : NaN;
            if (Number.isNaN(lastActionMs) || nowMs - lastActionMs < thresholdMs) {
                return false;
            }
            const lastReminderMs = record.approval.lastStaleNotificationAt
                ? new Date(record.approval.lastStaleNotificationAt).getTime()
                : Number.NEGATIVE_INFINITY;
            return lastReminderMs < lastActionMs;
        });
    }
    submitApprovalRecord(recordId, shipId, occurredAt, actor, transitionId, reason, note) {
        this.assertValidRole(actor, "actor");
        return this.applyApprovalTransition(recordId, shipId, actor, occurredAt, transitionId, "SUBMITTED", reason, note, (current) => {
            if (current.approval.status !== "DRAFT") {
                throw new Error(`Invalid approval status transition: ${current.approval.status} -> SUBMITTED`);
            }
            const nextIndex = current.approval.currentStepIndex + 1;
            if (nextIndex >= current.approval.chain.length) {
                throw new Error("Approval chain has no next owner for submit");
            }
            const nextOwner = this.getApprovalChainRole(current.approval.chain, nextIndex);
            return {
                approval: {
                    ...current.approval,
                    currentStepIndex: nextIndex,
                    approvalLevel: nextIndex,
                    currentOwner: nextOwner,
                    status: "SUBMITTED",
                    submittedAt: occurredAt,
                    rejectedAt: null,
                    lastActionBy: actor,
                    lastActionAt: occurredAt,
                    lastActionReason: reason,
                    lastActionNote: note,
                    version: current.approval.version + 1,
                },
            };
        });
    }
    approveApprovalRecord(recordId, shipId, occurredAt, actor, transitionId, reason, note) {
        this.assertValidRole(actor, "actor");
        return this.applyApprovalTransition(recordId, shipId, actor, occurredAt, transitionId, "APPROVED", reason, note, (current) => {
            if (current.approval.status !== "SUBMITTED") {
                throw new Error(`Invalid approval status transition: ${current.approval.status} -> APPROVED`);
            }
            if (current.approval.currentOwner !== actor) {
                throw new Error("Only the current owner may approve the record");
            }
            const isFinalStep = current.approval.currentStepIndex === current.approval.chain.length - 1;
            if (isFinalStep) {
                return {
                    approval: {
                        ...current.approval,
                        status: "APPROVED",
                        approvedAt: occurredAt,
                        lastActionBy: actor,
                        lastActionAt: occurredAt,
                        lastActionReason: reason,
                        lastActionNote: note,
                        version: current.approval.version + 1,
                    },
                };
            }
            const nextIndex = current.approval.currentStepIndex + 1;
            const nextOwner = this.getApprovalChainRole(current.approval.chain, nextIndex);
            return {
                approval: {
                    ...current.approval,
                    currentStepIndex: nextIndex,
                    approvalLevel: nextIndex,
                    currentOwner: nextOwner,
                    status: "SUBMITTED",
                    approvedAt: null,
                    lastActionBy: actor,
                    lastActionAt: occurredAt,
                    lastActionReason: reason,
                    lastActionNote: note,
                    version: current.approval.version + 1,
                },
            };
        });
    }
    rejectApprovalRecord(recordId, shipId, occurredAt, actor, transitionId, reason, note) {
        this.assertValidRole(actor, "actor");
        return this.applyApprovalTransition(recordId, shipId, actor, occurredAt, transitionId, "REJECTED", reason, note, (current) => {
            if (current.approval.status !== "SUBMITTED") {
                throw new Error(`Invalid approval status transition: ${current.approval.status} -> REJECTED`);
            }
            if (current.approval.currentOwner !== actor) {
                throw new Error("Only the current owner may reject the record");
            }
            const previousOwner = this.getPreviousApprovalOwner(recordId, current);
            const previousIndex = current.approval.chain.indexOf(previousOwner);
            if (previousIndex < 0 || previousIndex >= current.approval.currentStepIndex) {
                throw new Error("Approval rejection could not resolve a valid previous owner");
            }
            return {
                approval: {
                    ...current.approval,
                    currentStepIndex: previousIndex,
                    approvalLevel: previousIndex,
                    currentOwner: previousOwner,
                    status: "REJECTED",
                    rejectedAt: occurredAt,
                    approvedAt: null,
                    lastActionBy: actor,
                    lastActionAt: occurredAt,
                    lastActionReason: reason,
                    lastActionNote: note,
                    version: current.approval.version + 1,
                },
            };
        });
    }
    getAllTasks() {
        return [...this.tasksById.values()];
    }
    getTasksByShip(shipId) {
        this.assertValidShipId(shipId);
        return this.getAllTasks().filter((task) => task.shipId === shipId);
    }
    getOverdueTasks() {
        return this.getAllTasks().filter((task) => task.status === "OVERDUE");
    }
    getOverdueTasksByShip(shipId) {
        this.assertValidShipId(shipId);
        return this.getOverdueTasks().filter((task) => task.shipId === shipId);
    }
    saveShip(ship) {
        this.assertValidShip(ship);
        this.shipsById.set(ship.id, ship);
        this.persistState();
        return ship;
    }
    getShip(shipId) {
        return this.shipsById.get(shipId) ?? null;
    }
    getAllShips() {
        return [...this.shipsById.values()];
    }
    createNotification(input) {
        this.assertValidShipId(input.shipId);
        this.assertShipExists(input.shipId);
        this.assertValidRole(input.targetRole, "targetRole");
        const dedupeKey = this.buildNotificationDedupeKey(input);
        const existing = [...this.notificationsById.values()].find((notification) => notification.dedupeKey === dedupeKey);
        if (existing) {
            logger_1.logger.warn("duplicate_notification_skipped", {
                ...(input.taskId ? { taskId: input.taskId } : {}),
                status: dedupeKey,
            });
            return existing;
        }
        const notification = {
            ...input,
            id: `notification_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            dedupeKey,
            read: false,
        };
        this.notificationsById.set(notification.id, notification);
        this.persistState();
        return notification;
    }
    getNotifications(shipId, role) {
        this.assertValidShipId(shipId);
        this.assertValidRole(role, "role");
        return [...this.notificationsById.values()].filter((notification) => notification.shipId === shipId && notification.targetRole === role);
    }
    addComplianceSignals(signals) {
        for (const signal of signals) {
            this.assertValidComplianceSignal(signal);
            this.complianceSignalsByKey.set(this.buildComplianceSignalKey(signal), signal);
        }
        this.persistState();
    }
    getComplianceSignalsByShip(shipId) {
        this.assertValidShipId(shipId);
        return this.getAllComplianceSignals().filter((signal) => signal.shipId === shipId);
    }
    getAllComplianceSignals() {
        return [...this.complianceSignalsByKey.values()].sort((left, right) => this.compareComplianceSignals(left, right));
    }
    clearComplianceSignals() {
        this.complianceSignalsByKey.clear();
        this.persistState();
    }
    markNotificationRead(notificationId) {
        const notification = this.notificationsById.get(notificationId);
        if (!notification) {
            throw new Error(`Notification not found: ${notificationId}`);
        }
        if (notification.read) {
            return notification;
        }
        const next = {
            ...notification,
            read: true,
        };
        this.notificationsById.set(notificationId, next);
        this.persistState();
        return next;
    }
    flush() {
        this.persistState();
    }
    getHealthCheck() {
        const tasks = [...this.tasksById.values()];
        const perShip = Object.fromEntries([...this.shipsById.keys()].map((shipId) => {
            const shipTasks = tasks.filter((task) => task.shipId === shipId);
            return [
                shipId,
                {
                    totalTasks: shipTasks.length,
                    overdueTasks: shipTasks.filter((task) => task.status === "OVERDUE").length,
                    escalationCounts: {
                        none: shipTasks.filter((task) => task.escalationLevel === "NONE").length,
                        mcc: shipTasks.filter((task) => task.escalationLevel === "MCC").length,
                        logComd: shipTasks.filter((task) => task.escalationLevel === "LOG_COMD").length,
                    },
                },
            ];
        }));
        return {
            running: true,
            totalTasks: tasks.length,
            overdueTasks: tasks.filter((task) => task.status === "OVERDUE").length,
            escalationCounts: {
                none: tasks.filter((task) => task.escalationLevel === "NONE").length,
                mcc: tasks.filter((task) => task.escalationLevel === "MCC").length,
                logComd: tasks.filter((task) => task.escalationLevel === "LOG_COMD").length,
            },
            perShip,
            lastPersistenceTimestamp: this.lastPersistenceTimestamp,
        };
    }
    seedDailyLogs(shipId, businessDate, logTypes, submittedByRole = "MARINE_ENGINEERING_OFFICER") {
        const submittedAt = new Date().toISOString();
        for (const logType of logTypes) {
            this.saveLog({
                shipId,
                businessDate,
                logType,
                submittedAt,
                submittedByRole,
            });
        }
    }
    normalizeAwarenessOptions(options) {
        if (typeof options.shipId === "string") {
            this.assertValidShipId(options.shipId);
        }
        const now = options.now ?? new Date().toISOString();
        const nowMs = new Date(now).getTime();
        if (Number.isNaN(nowMs)) {
            throw new Error(`Invalid awareness timestamp: ${now}`);
        }
        const staleThresholdHours = options.staleThresholdHours ?? DEFAULT_AWARENESS_STALE_THRESHOLD_HOURS;
        const pendingThresholdHours = options.pendingThresholdHours ?? DEFAULT_AWARENESS_PENDING_THRESHOLD_HOURS;
        const recentlyRejectedWindowHours = options.recentlyRejectedWindowHours ?? DEFAULT_AWARENESS_REJECTED_WINDOW_HOURS;
        const topActionableLimit = options.topActionableLimit ?? DEFAULT_AWARENESS_TOP_ACTIONABLE_LIMIT;
        this.assertPositiveNumber(staleThresholdHours, "staleThresholdHours");
        this.assertPositiveNumber(pendingThresholdHours, "pendingThresholdHours");
        this.assertPositiveNumber(recentlyRejectedWindowHours, "recentlyRejectedWindowHours");
        this.assertPositiveInteger(topActionableLimit, "topActionableLimit");
        return {
            ...(typeof options.shipId === "string" ? { shipId: options.shipId } : {}),
            now,
            nowMs,
            staleThresholdHours,
            pendingThresholdHours,
            recentlyRejectedWindowHours,
            topActionableLimit,
        };
    }
    normalizeActorContext(actor) {
        this.assertValidAssignedRole(actor.role, "actor.role");
        if (typeof actor.shipId === "string") {
            this.assertValidShipId(actor.shipId);
        }
        if (this.requiresShipScopedVisibility(actor.role)) {
            if (!actor.shipId) {
                throw new Error(`shipId is required for role ${actor.role}`);
            }
            return {
                role: actor.role,
                shipId: actor.shipId,
            };
        }
        return {
            role: actor.role,
            ...(actor.shipId ? { shipId: actor.shipId } : {}),
        };
    }
    requiresShipScopedVisibility(role) {
        return (role === "MARINE_ENGINEERING_OFFICER" ||
            role === "WEAPON_ELECTRICAL_OFFICER" ||
            role === "COMMANDING_OFFICER");
    }
    resolveActorScopedShipId(actor, options) {
        if (this.requiresShipScopedVisibility(actor.role)) {
            return actor.shipId;
        }
        if (actor.shipId && options.shipId && actor.shipId !== options.shipId) {
            throw new Error(`shipId mismatch for actor ${actor.role}: ${actor.shipId} != ${options.shipId}`);
        }
        return options.shipId ?? actor.shipId;
    }
    getVisibleApprovalRecordsForAwareness(actor, options) {
        const scopedShipId = this.resolveActorScopedShipId(actor, options);
        const records = scopedShipId
            ? this.getApprovalRecordsVisibleToRole(scopedShipId, actor.role)
            : [...this.recordsById.values()].filter((record) => record.visibleTo.includes(actor.role));
        if (this.requiresShipScopedVisibility(actor.role)) {
            return records.filter((record) => record.shipId === actor.shipId);
        }
        return scopedShipId ? records.filter((record) => record.shipId === scopedShipId) : records;
    }
    isRecordVisibleToActor(record, actor) {
        if (!record.visibleTo.includes(actor.role)) {
            return false;
        }
        if (this.requiresShipScopedVisibility(actor.role)) {
            return record.shipId === actor.shipId;
        }
        if (actor.shipId) {
            return record.shipId === actor.shipId;
        }
        return true;
    }
    projectApprovalAwarenessRecord(record, role, options) {
        if (!record.visibleTo.includes(role)) {
            throw new Error(`Awareness projection cannot include invisible record: ${record.id}`);
        }
        const ship = this.getShip(record.shipId);
        if (!ship) {
            throw new Error(`Ship not found for awareness projection: ${record.shipId}`);
        }
        const history = [...(this.approvalHistoryById.get(record.id) ?? [])];
        const lastHistory = history.length > 0 ? history[history.length - 1] : null;
        const ageHoursSinceLastAction = this.getElapsedHours(options.nowMs, record.approval.lastActionAt);
        const ageHoursSinceSubmission = this.getElapsedHours(options.nowMs, record.approval.submittedAt);
        const isStale = this.isAwarenessRecordStale(record, options.nowMs, options.staleThresholdHours);
        const isPendingTooLong = this.isAwarenessRecordPendingTooLong(record, options.nowMs, options.pendingThresholdHours);
        const attentionSignals = this.resolveAwarenessAttentionSignals(record, isStale, isPendingTooLong);
        const bucket = this.resolveAwarenessBucket(record, role, options.nowMs, options.recentlyRejectedWindowHours);
        return {
            recordId: record.id,
            shipId: record.shipId,
            shipName: ship.name,
            shipClass: ship.classType,
            kind: record.kind,
            title: record.title,
            businessDate: record.businessDate,
            originRole: record.originRole,
            status: record.approval.status,
            currentOwner: record.approval.currentOwner,
            approvalLevel: record.approval.approvalLevel,
            currentStepIndex: record.approval.currentStepIndex,
            chain: [...record.approval.chain],
            visibleTo: [...record.visibleTo],
            createdAt: record.createdAt,
            submittedAt: record.approval.submittedAt,
            approvedAt: record.approval.approvedAt,
            rejectedAt: record.approval.rejectedAt,
            lastActionAt: record.approval.lastActionAt,
            lastActionBy: record.approval.lastActionBy,
            lastActionReason: record.approval.lastActionReason,
            lastActionNote: record.approval.lastActionNote,
            lastHistoryAction: lastHistory?.actionType ?? null,
            lastHistoryAt: lastHistory?.timestamp ?? null,
            previousOwner: this.resolveAwarenessPreviousOwner(record.approval.currentOwner, history),
            bucket,
            attentionSignals,
            ageHoursSinceLastAction,
            ageHoursSinceSubmission,
            computed: {
                isStale,
                isPendingTooLong,
            },
        };
    }
    resolveAwarenessBucket(record, role, nowMs, recentlyRejectedWindowHours) {
        if (record.approval.currentOwner === role && record.approval.status === "SUBMITTED") {
            return "PENDING_MY_ACTION";
        }
        if (this.isRecentlyRejected(record, nowMs, recentlyRejectedWindowHours)) {
            return "RECENTLY_REJECTED";
        }
        if (record.approval.currentOwner === role) {
            return "OWNED";
        }
        return "VISIBLE_NOT_OWNED";
    }
    resolveAwarenessAttentionSignals(record, isStale, isPendingTooLong) {
        const signals = [];
        if (isStale) {
            signals.push("STALE");
        }
        if (record.approval.status === "REJECTED") {
            signals.push("BLOCKED_BY_REJECTION");
        }
        if (isPendingTooLong) {
            signals.push("PENDING_TOO_LONG");
        }
        return signals;
    }
    isAwarenessRecordPendingTooLong(record, nowMs, pendingThresholdHours) {
        if (record.approval.status !== "SUBMITTED" || record.approval.submittedAt === null) {
            return false;
        }
        const ageHoursSinceSubmission = this.getElapsedHours(nowMs, record.approval.submittedAt);
        return ageHoursSinceSubmission !== null && ageHoursSinceSubmission >= pendingThresholdHours;
    }
    isAwarenessRecordStale(record, nowMs, staleThresholdHours) {
        if (record.approval.status === "APPROVED" || record.approval.status === "REJECTED") {
            return false;
        }
        if (record.approval.lastActionAt === null) {
            return false;
        }
        const ageHoursSinceLastAction = this.getElapsedHours(nowMs, record.approval.lastActionAt);
        return ageHoursSinceLastAction !== null && ageHoursSinceLastAction >= staleThresholdHours;
    }
    isRecentlyRejected(record, nowMs, recentlyRejectedWindowHours) {
        if (record.approval.status !== "REJECTED" || record.approval.rejectedAt === null) {
            return false;
        }
        const ageHoursSinceRejection = this.getElapsedHours(nowMs, record.approval.rejectedAt);
        return ageHoursSinceRejection !== null && ageHoursSinceRejection <= recentlyRejectedWindowHours;
    }
    resolveAwarenessPreviousOwner(currentOwner, history) {
        for (let index = history.length - 1; index >= 0; index -= 1) {
            const entry = history[index];
            if (!entry) {
                continue;
            }
            if (entry.actionType === "INVALID_ATTEMPT" || entry.actionType === "STALE_REMINDER_SENT") {
                continue;
            }
            if (entry.actionType !== "SUBMITTED" && entry.actionType !== "APPROVED") {
                continue;
            }
            if (entry.previousState.currentOwner === entry.newState.currentOwner) {
                continue;
            }
            if (entry.previousState.currentOwner === currentOwner) {
                return entry.newState.currentOwner;
            }
            if (entry.newState.currentOwner === currentOwner) {
                return entry.previousState.currentOwner;
            }
        }
        return null;
    }
    compareAwarenessRecords(left, right) {
        const priorityDifference = this.getAwarenessSortPriority(left) - this.getAwarenessSortPriority(right);
        if (priorityDifference !== 0) {
            return priorityDifference;
        }
        return this.compareByAgeThenCreatedAt(left, right);
    }
    compareByAgeThenCreatedAt(left, right) {
        const leftAge = left.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
        const rightAge = right.ageHoursSinceLastAction ?? Number.NEGATIVE_INFINITY;
        if (leftAge !== rightAge) {
            return rightAge - leftAge;
        }
        return left.createdAt.localeCompare(right.createdAt);
    }
    getAwarenessSortPriority(record) {
        if (record.bucket === "PENDING_MY_ACTION" && record.attentionSignals.length > 0) {
            return 0;
        }
        switch (record.bucket) {
            case "PENDING_MY_ACTION":
                return 1;
            case "RECENTLY_REJECTED":
                return 2;
            case "OWNED":
                return 3;
            case "VISIBLE_NOT_OWNED":
                return 4;
            default:
                return 5;
        }
    }
    getElapsedHours(nowMs, timestamp) {
        if (timestamp === null) {
            return null;
        }
        const timestampMs = new Date(timestamp).getTime();
        if (Number.isNaN(timestampMs)) {
            return null;
        }
        return Math.max(0, Math.floor((nowMs - timestampMs) / (60 * 60 * 1000)));
    }
    assertApprovalAwarenessRecords(actor, records) {
        const seenRecordIds = new Set();
        for (const record of records) {
            if (!record.visibleTo.includes(actor.role)) {
                throw new Error(`Awareness record leaked outside visibility scope: ${record.recordId}`);
            }
            if (this.requiresShipScopedVisibility(actor.role) && record.shipId !== actor.shipId) {
                throw new Error(`Awareness record leaked outside actor ship scope: ${record.recordId}`);
            }
            if (seenRecordIds.has(record.recordId)) {
                throw new Error(`Duplicate awareness record detected: ${record.recordId}`);
            }
            seenRecordIds.add(record.recordId);
            const resolvedBucket = (() => {
                switch (record.bucket) {
                    case "PENDING_MY_ACTION":
                        return record.currentOwner === actor.role && record.status === "SUBMITTED";
                    case "RECENTLY_REJECTED":
                        return record.status === "REJECTED" && record.rejectedAt !== null;
                    case "OWNED":
                        return record.currentOwner === actor.role;
                    case "VISIBLE_NOT_OWNED":
                        return record.currentOwner !== actor.role;
                    default:
                        return false;
                }
            })();
            if (!resolvedBucket) {
                throw new Error(`Awareness bucket integrity check failed: ${record.recordId}`);
            }
            if (record.computed.isPendingTooLong !== record.attentionSignals.includes("PENDING_TOO_LONG")) {
                throw new Error(`Pending-too-long mismatch in awareness record: ${record.recordId}`);
            }
            if (record.computed.isStale !== record.attentionSignals.includes("STALE")) {
                throw new Error(`Stale mismatch in awareness record: ${record.recordId}`);
            }
        }
    }
    assertApprovalAwarenessSummary(summary, actor) {
        const records = summary.records;
        const byStatus = Object.values(summary.countsByStatus).reduce((sum, count) => sum + count, 0);
        const byRole = Object.values(summary.countsByRole).reduce((sum, count) => sum + count, 0);
        const byShip = Object.values(summary.countsByShip).reduce((sum, count) => sum + count, 0);
        if (summary.totals.visible !== records.length) {
            throw new Error("Awareness summary visible total does not match records length");
        }
        if (byStatus !== records.length || byRole !== records.length || byShip !== records.length) {
            throw new Error("Awareness summary aggregates do not match filtered dataset");
        }
        for (const record of summary.topActionableRecords) {
            if (record.bucket !== "PENDING_MY_ACTION") {
                throw new Error(`Top actionable awareness record is not actionable: ${record.recordId}`);
            }
            if (!record.visibleTo.includes(actor.role)) {
                throw new Error(`Top actionable awareness record leaked visibility: ${record.recordId}`);
            }
            if (this.requiresShipScopedVisibility(actor.role) && record.shipId !== actor.shipId) {
                throw new Error(`Top actionable awareness record leaked ship scope: ${record.recordId}`);
            }
        }
    }
    assertPositiveNumber(value, fieldName) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`${fieldName} must be a positive number`);
        }
    }
    assertPositiveInteger(value, fieldName) {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`${fieldName} must be a positive integer`);
        }
    }
    requireTask(taskId) {
        const task = this.getTask(taskId);
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }
        return task;
    }
    getDailyStateKey(shipId, businessDate) {
        this.assertValidShipId(shipId);
        return `${shipId}:${businessDate}`;
    }
    appendTaskHistory(taskId, shipId, actionType, previousState, newState, timestamp, actor) {
        const current = this.taskHistoryById.get(taskId) ?? [];
        current.push({
            taskId,
            shipId,
            timestamp,
            actionType,
            previousState,
            newState,
            actor,
        });
        this.taskHistoryById.set(taskId, current);
        logger_1.logger.stateChange({
            taskId,
            actionType,
            status: newState.status,
            result: `${previousState.status}->${newState.status}`,
        });
    }
    appendApprovalHistory(recordId, shipId, actionType, previousState, newState, timestamp, actor, transitionId, reason, note) {
        const current = this.approvalHistoryById.get(recordId) ?? [];
        current.push({
            recordId,
            shipId,
            timestamp,
            actionType,
            previousState,
            newState,
            actor,
            transitionId,
            reason,
            note,
        });
        this.approvalHistoryById.set(recordId, current);
        logger_1.logger.stateChange({
            actionType,
            status: newState.status,
            result: `${previousState.status}->${newState.status}`,
        });
    }
    recordApprovalInvalidAttempt(recordId, shipId, occurredAt, actor, transitionId, reason, note) {
        const record = this.getApprovalRecordInShip(recordId, shipId);
        if (!record) {
            return;
        }
        const state = this.createApprovalSnapshot(record);
        this.appendApprovalHistory(recordId, shipId, "INVALID_ATTEMPT", state, state, occurredAt, actor, transitionId, reason, note);
        this.persistState();
    }
    recordApprovalStaleNotification(recordId, shipId, occurredAt, actor) {
        const record = this.getApprovalRecordInShip(recordId, shipId);
        if (!record) {
            throw new Error("Approval record does not exist in the provided ship context");
        }
        this.assertApprovalRecordMutable(record, "stale reminder");
        const previousState = this.createApprovalSnapshot(record);
        const next = {
            ...record,
            approval: {
                ...record.approval,
                lastStaleNotificationAt: occurredAt,
            },
        };
        this.recordsById.set(recordId, next);
        const newState = this.createApprovalSnapshot(next);
        this.appendApprovalHistory(recordId, shipId, "STALE_REMINDER_SENT", previousState, newState, occurredAt, actor, null, "Stale approval reminder sent", null);
        this.persistState();
        return next;
    }
    applyTaskUpdate(taskId, update, actionType, occurredAt, actor) {
        const current = this.requireTask(taskId);
        const previousState = this.createStateSnapshot(current);
        const next = {
            ...current,
            ...update,
        };
        this.tasksById.set(taskId, next);
        const newState = this.createStateSnapshot(next);
        if (!this.isSameState(previousState, newState)) {
            this.appendTaskHistory(taskId, next.shipId, actionType, previousState, newState, occurredAt, actor);
        }
        this.persistState();
        return next;
    }
    createStateSnapshot(task) {
        return {
            shipId: task.shipId,
            parentTaskId: task.parentTaskId,
            kind: task.kind,
            assignedRole: task.assignedRole,
            status: task.status,
            completedAt: task.completedAt,
            lastCheckedAt: task.lastCheckedAt,
            lastOverdueAt: task.lastOverdueAt,
            replannedFromDueDate: task.replannedFromDueDate,
            replannedToDueDate: task.replannedToDueDate,
            escalationLevel: task.escalationLevel,
            dueDate: task.dueDate,
            lastNotifiedAt: task.lastNotifiedAt,
            ettrDays: task.ettrDays,
            severity: task.severity,
            escalatedAt: task.escalatedAt,
        };
    }
    createApprovalSnapshot(record) {
        return {
            shipId: record.shipId,
            kind: record.kind,
            title: record.title,
            businessDate: record.businessDate,
            originRole: record.originRole,
            chain: [...record.approval.chain],
            currentStepIndex: record.approval.currentStepIndex,
            approvalLevel: record.approval.approvalLevel,
            currentOwner: record.approval.currentOwner,
            status: record.approval.status,
            submittedAt: record.approval.submittedAt,
            approvedAt: record.approval.approvedAt,
            rejectedAt: record.approval.rejectedAt,
            lastActionBy: record.approval.lastActionBy,
            lastActionAt: record.approval.lastActionAt,
            lastActionReason: record.approval.lastActionReason,
            lastActionNote: record.approval.lastActionNote,
            lastStaleNotificationAt: record.approval.lastStaleNotificationAt,
            version: record.approval.version,
        };
    }
    isSameState(left, right) {
        return (left.shipId === right.shipId &&
            left.parentTaskId === right.parentTaskId &&
            left.kind === right.kind &&
            left.assignedRole === right.assignedRole &&
            left.status === right.status &&
            left.completedAt === right.completedAt &&
            left.lastCheckedAt === right.lastCheckedAt &&
            left.lastOverdueAt === right.lastOverdueAt &&
            left.replannedFromDueDate === right.replannedFromDueDate &&
            left.replannedToDueDate === right.replannedToDueDate &&
            left.escalationLevel === right.escalationLevel &&
            left.dueDate === right.dueDate &&
            left.lastNotifiedAt === right.lastNotifiedAt &&
            left.ettrDays === right.ettrDays &&
            left.severity === right.severity &&
            left.escalatedAt === right.escalatedAt);
    }
    isSameApprovalState(left, right) {
        return (left.shipId === right.shipId &&
            left.kind === right.kind &&
            left.title === right.title &&
            left.businessDate === right.businessDate &&
            left.originRole === right.originRole &&
            left.chain.length === right.chain.length &&
            left.chain.every((role, index) => role === right.chain[index]) &&
            left.currentStepIndex === right.currentStepIndex &&
            left.approvalLevel === right.approvalLevel &&
            left.currentOwner === right.currentOwner &&
            left.status === right.status &&
            left.submittedAt === right.submittedAt &&
            left.approvedAt === right.approvedAt &&
            left.rejectedAt === right.rejectedAt &&
            left.lastActionBy === right.lastActionBy &&
            left.lastActionAt === right.lastActionAt &&
            left.lastActionReason === right.lastActionReason &&
            left.lastActionNote === right.lastActionNote &&
            left.lastStaleNotificationAt === right.lastStaleNotificationAt &&
            left.version === right.version);
    }
    applyApprovalTransition(recordId, shipId, actor, occurredAt, transitionId, actionType, reason, note, mutator) {
        this.assertValidShipId(shipId);
        const current = this.getApprovalRecordInShip(recordId, shipId);
        if (!current) {
            throw new Error("Approval record does not exist in the provided ship context");
        }
        const processedRecordId = this.processedTransitions.get(transitionId);
        if (processedRecordId) {
            if (processedRecordId.recordId !== recordId || processedRecordId.actionType !== actionType) {
                throw new Error(`Transition ID already used for another record: ${transitionId}`);
            }
            return current;
        }
        if (this.isTerminalApprovalStatus(current.approval.status)) {
            this.recordApprovalInvalidAttempt(recordId, shipId, occurredAt, actor, transitionId, `Transition blocked in terminal state: ${current.approval.status}`, note);
            throw new Error(`Approval record is in terminal state: ${current.approval.status}`);
        }
        const previousState = this.createApprovalSnapshot(current);
        let next;
        try {
            next = {
                ...current,
                ...mutator(current),
            };
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : "Invalid approval transition";
            this.recordApprovalInvalidAttempt(recordId, shipId, occurredAt, actor, transitionId, reason, note);
            throw error;
        }
        this.assertValidFleetRecord(next);
        this.recordsById.set(recordId, next);
        const newState = this.createApprovalSnapshot(next);
        if (!this.isSameApprovalState(previousState, newState)) {
            this.appendApprovalHistory(recordId, shipId, actionType, previousState, newState, occurredAt, actor, transitionId, reason, note);
        }
        this.processedTransitions.set(transitionId, {
            recordId,
            actionType,
        });
        this.persistState();
        return next;
    }
    assertTaskStatusTransition(current, next) {
        if (current === next) {
            return;
        }
        const allowedTransitions = {
            PENDING: ["COMPLETED", "OVERDUE"],
            OVERDUE: ["COMPLETED"],
            COMPLETED: [],
        };
        if (!allowedTransitions[current].includes(next)) {
            throw new Error(`Invalid task status transition: ${current} -> ${next}`);
        }
    }
    assertEscalationTransition(current, next) {
        const allowedTransitions = {
            NONE: ["MCC", "LOG_COMD"],
            MCC: ["LOG_COMD"],
            LOG_COMD: [],
        };
        if (current === next) {
            return;
        }
        if (!allowedTransitions[current].includes(next)) {
            throw new Error(`Invalid escalation transition: ${current} -> ${next}`);
        }
    }
    isTerminalApprovalStatus(status) {
        return status === "APPROVED" || status === "REJECTED";
    }
    assertApprovalRecordMutable(record, operation) {
        if (this.isTerminalApprovalStatus(record.approval.status)) {
            throw new Error(`Approval record is immutable in terminal state during ${operation}: ${record.approval.status}`);
        }
    }
    assertValidRole(role, fieldName) {
        if (!this.isRoleId(role)) {
            logger_1.logger.error("role_validation_failed", new Error(`Invalid ${fieldName}`), {
                actionType: fieldName,
                status: String(role),
            });
            throw new Error(`Invalid ${fieldName}: ${String(role)}`);
        }
    }
    assertValidAssignedRole(role, fieldName) {
        if (!this.isAssignedRoleId(role)) {
            logger_1.logger.error("assigned_role_validation_failed", new Error(`Invalid ${fieldName}`), {
                actionType: fieldName,
                status: String(role),
            });
            throw new Error(`Invalid ${fieldName}: ${String(role)}`);
        }
    }
    assertValidShipId(shipId) {
        if (typeof shipId !== "string" || shipId.trim() === "") {
            logger_1.logger.error("ship_id_validation_failed", new Error("Invalid shipId"), {
                actionType: "shipId",
                status: String(shipId),
            });
            throw new Error(`Invalid shipId: ${String(shipId)}`);
        }
    }
    assertValidShip(ship) {
        if (typeof ship.id !== "string" ||
            ship.id.trim() === "" ||
            typeof ship.name !== "string" ||
            ship.name.trim() === "" ||
            typeof ship.classType !== "string" ||
            ship.classType.trim() === "") {
            logger_1.logger.error("ship_validation_failed", new Error("Invalid ship"), {
                actionType: "ship",
                status: ship.id ?? "UNKNOWN",
            });
            throw new Error("Invalid ship");
        }
    }
    assertShipExists(shipId) {
        if (!this.shipsById.has(shipId)) {
            logger_1.logger.error("ship_not_found", new Error("Unknown ship"), {
                actionType: "shipId",
                status: shipId,
            });
            throw new Error(`Unknown shipId: ${shipId}`);
        }
    }
    loadPersistedState() {
        const loaded = this.tryLoadFromPath(this.persistenceFilePath)
            ?? this.tryLoadFromPath(this.backupFilePath);
        if (!loaded) {
            this.resetPersistedState();
            return;
        }
        const { state: persisted, path } = loaded;
        this.tasksById.clear();
        this.shipsById.clear();
        for (const ship of persisted.ships) {
            this.shipsById.set(ship.id, ship);
        }
        for (const task of persisted.tasks) {
            this.tasksById.set(task.id, task);
        }
        this.taskHistoryById.clear();
        for (const [taskId, history] of persisted.taskHistory) {
            this.taskHistoryById.set(taskId, history);
        }
        this.recordsById.clear();
        for (const record of persisted.records) {
            this.recordsById.set(record.id, record);
        }
        this.approvalHistoryById.clear();
        for (const [recordId, history] of persisted.approvalHistory) {
            this.approvalHistoryById.set(recordId, history);
        }
        this.processedTransitions.clear();
        for (const [transitionId, transition] of persisted.processedTransitions) {
            this.processedTransitions.set(transitionId, transition);
        }
        this.processedEventsById.clear();
        for (const [eventId, processedAt] of Object.entries(persisted.processedEvents)) {
            this.processedEventsById.set(eventId, processedAt);
        }
        this.escalationByDate.clear();
        for (const [businessDate, escalationState] of persisted.escalationState) {
            this.escalationByDate.set(businessDate, escalationState);
        }
        this.notificationsById.clear();
        for (const notification of persisted.notifications) {
            this.notificationsById.set(notification.id, notification);
        }
        this.complianceSignalsByKey.clear();
        for (const signal of persisted.complianceSignals) {
            this.complianceSignalsByKey.set(this.buildComplianceSignalKey(signal), signal);
        }
        try {
            this.lastPersistenceTimestamp = (0, fs_1.statSync)(path).mtime.toISOString();
        }
        catch (error) {
            logger_1.logger.error("persisted_state_stat_failed", error, {
                result: path,
                status: "STAT_FAILED",
            });
            this.lastPersistenceTimestamp = null;
        }
    }
    tryLoadFromPath(path) {
        if (!(0, fs_1.existsSync)(path)) {
            return null;
        }
        try {
            const raw = (0, fs_1.readFileSync)(path, "utf8");
            if (raw.trim() === "") {
                logger_1.logger.warn("persisted_state_empty", { result: path, status: "EMPTY" });
                return null;
            }
            const parsed = JSON.parse(raw);
            const migrated = this.tryMigratePersistedState(parsed, path);
            if (!migrated) {
                logger_1.logger.warn("persisted_state_invalid", { result: path, status: "INVALID" });
                return null;
            }
            if (!this.validatePersistedState(migrated)) {
                logger_1.logger.warn("persisted_state_invalid", { result: path, status: "INVALID" });
                return null;
            }
            return { state: migrated, path };
        }
        catch (error) {
            logger_1.logger.error("persisted_state_load_failed", error, {
                result: path,
                status: "LOAD_FAILED",
            });
            return null;
        }
    }
    validatePersistedState(value) {
        if (!isRecord(value)) {
            return false;
        }
        if (value.version !== STORE_STATE_VERSION) {
            return false;
        }
        if (!Array.isArray(value.tasks) || !value.tasks.every((item) => this.isTask(item))) {
            return false;
        }
        if (!Array.isArray(value.ships) || !value.ships.every((item) => this.isShip(item))) {
            return false;
        }
        if (!Array.isArray(value.taskHistory) ||
            !value.taskHistory.every((entry) => this.isTaskHistoryTuple(entry))) {
            return false;
        }
        if (!Array.isArray(value.records) || !value.records.every((item) => this.isFleetRecord(item))) {
            return false;
        }
        if (!Array.isArray(value.approvalHistory) ||
            !value.approvalHistory.every((entry) => this.isApprovalHistoryTuple(entry))) {
            return false;
        }
        if (!Array.isArray(value.processedTransitions) ||
            !value.processedTransitions.every((entry) => this.isProcessedTransitionTuple(entry))) {
            return false;
        }
        if (!isRecord(value.processedEvents) ||
            !Object.entries(value.processedEvents).every(([eventId, processedAt]) => typeof eventId === "string" &&
                eventId.trim() !== "" &&
                typeof processedAt === "number" &&
                Number.isFinite(processedAt))) {
            return false;
        }
        if (!Array.isArray(value.escalationState) ||
            !value.escalationState.every((entry) => this.isEscalationStateTuple(entry))) {
            return false;
        }
        if (!Array.isArray(value.notifications) ||
            !value.notifications.every((entry) => this.isNotification(entry))) {
            return false;
        }
        if (!Array.isArray(value.complianceSignals) ||
            !value.complianceSignals.every((entry) => this.isComplianceSignal(entry))) {
            return false;
        }
        return true;
    }
    tryMigratePersistedState(value, path) {
        if (!isRecord(value)) {
            return null;
        }
        if (value.version === STORE_STATE_VERSION) {
            return value;
        }
        if (value.version === 9) {
            return {
                version: STORE_STATE_VERSION,
                ships: value.ships,
                tasks: value.tasks,
                taskHistory: value.taskHistory,
                records: value.records,
                approvalHistory: value.approvalHistory,
                processedTransitions: value.processedTransitions,
                processedEvents: {},
                escalationState: value.escalationState,
                notifications: value.notifications,
                complianceSignals: value.complianceSignals,
            };
        }
        if (value.version === 8) {
            return {
                version: STORE_STATE_VERSION,
                ships: value.ships,
                tasks: value.tasks,
                taskHistory: value.taskHistory,
                records: value.records,
                approvalHistory: value.approvalHistory,
                processedTransitions: value.processedTransitions,
                processedEvents: {},
                escalationState: value.escalationState,
                notifications: value.notifications,
                complianceSignals: [],
            };
        }
        logger_1.logger.warn("persisted_state_version_mismatch", {
            result: path,
            status: `EXPECTED_${STORE_STATE_VERSION}_RECEIVED_${String(value.version ?? "UNKNOWN")}`,
        });
        logger_1.logger.warn("persisted_state_migration_unavailable", {
            result: path,
            status: "NO_MIGRATION_PATH_CONFIGURED",
        });
        return null;
    }
    isTask(value) {
        if (!isRecord(value)) {
            return false;
        }
        return (typeof value.id === "string" &&
            typeof value.shipId === "string" &&
            value.shipId.trim() !== "" &&
            isNullableString(value.parentTaskId) &&
            (value.kind === "PMS" || value.kind === "DEFECT") &&
            typeof value.title === "string" &&
            typeof value.businessDate === "string" &&
            typeof value.dueDate === "string" &&
            this.isAssignedRoleId(value.assignedRole) &&
            (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
            isNullableString(value.completedAt) &&
            isNullableString(value.lastCheckedAt) &&
            isNullableString(value.lastOverdueAt) &&
            isNullableString(value.replannedFromDueDate) &&
            isNullableString(value.replannedToDueDate) &&
            isNullableString(value.lastNotifiedAt) &&
            (typeof value.ettrDays === "number" || value.ettrDays === null) &&
            (value.severity === "ROUTINE" ||
                value.severity === "URGENT" ||
                value.severity === "CRITICAL" ||
                value.severity === null) &&
            (value.escalationLevel === "NONE" ||
                value.escalationLevel === "MCC" ||
                value.escalationLevel === "LOG_COMD") &&
            isNullableString(value.escalatedAt));
    }
    isFleetRecord(value) {
        if (!isRecord(value)) {
            return false;
        }
        return (typeof value.id === "string" &&
            typeof value.shipId === "string" &&
            value.shipId.trim() !== "" &&
            this.isFleetRecordKind(value.kind) &&
            typeof value.title === "string" &&
            value.title.trim() !== "" &&
            (typeof value.description === "string" || value.description === null) &&
            typeof value.businessDate === "string" &&
            typeof value.createdAt === "string" &&
            this.isAssignedRoleId(value.originRole) &&
            Array.isArray(value.visibleTo) &&
            value.visibleTo.length >= 1 &&
            value.visibleTo.every((role) => this.isAssignedRoleId(role)) &&
            this.isApprovalFlow(value.approval));
    }
    isShip(value) {
        return (isRecord(value) &&
            typeof value.id === "string" &&
            value.id.trim() !== "" &&
            typeof value.name === "string" &&
            value.name.trim() !== "" &&
            typeof value.classType === "string" &&
            value.classType.trim() !== "");
    }
    isTaskHistoryTuple(value) {
        return (Array.isArray(value) &&
            value.length === 2 &&
            typeof value[0] === "string" &&
            Array.isArray(value[1]) &&
            value[1].every((entry) => this.isTaskHistoryEntry(entry)));
    }
    isTaskHistoryEntry(value) {
        if (!isRecord(value)) {
            return false;
        }
        return (typeof value.taskId === "string" &&
            typeof value.shipId === "string" &&
            value.shipId.trim() !== "" &&
            typeof value.timestamp === "string" &&
            this.isTaskHistoryType(value.actionType) &&
            this.isTaskStateSnapshot(value.previousState) &&
            this.isTaskStateSnapshot(value.newState) &&
            (value.actor === "SYSTEM" || this.isRoleId(value.actor)));
    }
    isApprovalHistoryTuple(value) {
        return (Array.isArray(value) &&
            value.length === 2 &&
            typeof value[0] === "string" &&
            Array.isArray(value[1]) &&
            value[1].every((entry) => this.isApprovalHistoryEntry(entry)));
    }
    isApprovalHistoryEntry(value) {
        if (!isRecord(value)) {
            return false;
        }
        return (typeof value.recordId === "string" &&
            typeof value.shipId === "string" &&
            value.shipId.trim() !== "" &&
            typeof value.timestamp === "string" &&
            this.isApprovalHistoryType(value.actionType) &&
            this.isApprovalRecordSnapshot(value.previousState) &&
            this.isApprovalRecordSnapshot(value.newState) &&
            (value.actor === "SYSTEM" || this.isRoleId(value.actor)) &&
            (typeof value.transitionId === "string" || value.transitionId === null) &&
            (typeof value.reason === "string" || value.reason === null) &&
            (typeof value.note === "string" || value.note === null));
    }
    isTaskStateSnapshot(value) {
        if (!isRecord(value)) {
            return false;
        }
        return (typeof value.shipId === "string" &&
            value.shipId.trim() !== "" &&
            isNullableString(value.parentTaskId) &&
            (value.kind === "PMS" || value.kind === "DEFECT") &&
            (value.assignedRole === "COMMANDING_OFFICER" ||
                value.assignedRole === "MARINE_ENGINEERING_OFFICER" ||
                value.assignedRole === "WEAPON_ELECTRICAL_OFFICER" ||
                value.assignedRole === "FLEET_SUPPORT_GROUP" ||
                value.assignedRole === "LOGISTICS_COMMAND") &&
            (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
            isNullableString(value.completedAt) &&
            isNullableString(value.lastCheckedAt) &&
            isNullableString(value.lastOverdueAt) &&
            isNullableString(value.replannedFromDueDate) &&
            isNullableString(value.replannedToDueDate) &&
            (value.escalationLevel === "NONE" ||
                value.escalationLevel === "MCC" ||
                value.escalationLevel === "LOG_COMD") &&
            typeof value.dueDate === "string" &&
            isNullableString(value.lastNotifiedAt) &&
            (typeof value.ettrDays === "number" || value.ettrDays === null) &&
            (value.severity === "ROUTINE" ||
                value.severity === "URGENT" ||
                value.severity === "CRITICAL" ||
                value.severity === null) &&
            isNullableString(value.escalatedAt));
    }
    isApprovalRecordSnapshot(value) {
        if (!isRecord(value)) {
            return false;
        }
        return (typeof value.shipId === "string" &&
            value.shipId.trim() !== "" &&
            this.isFleetRecordKind(value.kind) &&
            typeof value.title === "string" &&
            typeof value.businessDate === "string" &&
            this.isAssignedRoleId(value.originRole) &&
            Array.isArray(value.chain) &&
            value.chain.length >= 2 &&
            value.chain.every((role) => this.isAssignedRoleId(role)) &&
            typeof value.currentStepIndex === "number" &&
            typeof value.approvalLevel === "number" &&
            this.isAssignedRoleId(value.currentOwner) &&
            this.isApprovalStatus(value.status) &&
            isNullableString(value.submittedAt) &&
            isNullableString(value.approvedAt) &&
            isNullableString(value.rejectedAt) &&
            (value.lastActionBy === null || value.lastActionBy === "SYSTEM" || this.isRoleId(value.lastActionBy)) &&
            isNullableString(value.lastActionAt) &&
            isNullableString(value.lastActionReason) &&
            isNullableString(value.lastActionNote) &&
            isNullableString(value.lastStaleNotificationAt) &&
            typeof value.version === "number");
    }
    isEscalationStateTuple(value) {
        return (Array.isArray(value) &&
            value.length === 2 &&
            typeof value[0] === "string" &&
            this.isEscalationState(value[1]));
    }
    isEscalationState(value) {
        if (!isRecord(value)) {
            return false;
        }
        return (typeof value.shipId === "string" &&
            value.shipId.trim() !== "" &&
            typeof value.businessDate === "string" &&
            (value.status === "NOT_ESCALATED" || value.status === "ESCALATED_TO_CO") &&
            (value.reason === "MISSING_DAILY_LOGS" || value.reason === null) &&
            Array.isArray(value.missingLogsAtEscalation) &&
            value.missingLogsAtEscalation.every((item) => item === "ENGINE_ROOM_REGISTER" || item === "EQUIPMENT_OPERATION_RECORD") &&
            isNullableString(value.escalatedAt) &&
            (value.targetRole === null || this.isRoleId(value.targetRole)));
    }
    isNotification(value) {
        return (isRecord(value) &&
            typeof value.id === "string" &&
            typeof value.type === "string" &&
            value.type.trim() !== "" &&
            (typeof value.dedupeKey === "undefined" ||
                (typeof value.dedupeKey === "string" && value.dedupeKey.trim() !== "")) &&
            typeof value.shipId === "string" &&
            value.shipId.trim() !== "" &&
            isNullableString(value.taskId) &&
            (typeof value.recordId === "undefined" || isNullableString(value.recordId)) &&
            typeof value.message === "string" &&
            this.isRoleId(value.targetRole) &&
            typeof value.timestamp === "string" &&
            typeof value.read === "boolean");
    }
    isComplianceSignal(value) {
        return (isRecord(value) &&
            typeof value.type === "string" &&
            value.type.trim() !== "" &&
            (value.severity === "INFO" ||
                value.severity === "WARNING" ||
                value.severity === "CRITICAL") &&
            typeof value.message === "string" &&
            value.message.trim() !== "" &&
            (typeof value.shipId === "undefined" ||
                (typeof value.shipId === "string" && value.shipId.trim() !== "")) &&
            (typeof value.taskId === "undefined" ||
                (typeof value.taskId === "string" && value.taskId.trim() !== "")) &&
            (typeof value.defectId === "undefined" ||
                (typeof value.defectId === "string" && value.defectId.trim() !== "")));
    }
    isProcessedTransitionTuple(value) {
        return (Array.isArray(value) &&
            value.length === 2 &&
            typeof value[0] === "string" &&
            this.isProcessedApprovalTransition(value[1]));
    }
    isProcessedApprovalTransition(value) {
        return (isRecord(value) &&
            typeof value.recordId === "string" &&
            this.isApprovalHistoryType(value.actionType));
    }
    buildNotificationDedupeKey(input) {
        return [
            input.shipId,
            input.type,
            input.taskId ?? "NO_TASK",
            input.recordId ?? "NO_RECORD",
            input.targetRole,
        ].join("|");
    }
    isRoleId(value) {
        return (value === "COMMANDING_OFFICER" ||
            value === "MARINE_ENGINEERING_OFFICER" ||
            value === "WEAPON_ELECTRICAL_OFFICER" ||
            value === "FLEET_SUPPORT_GROUP" ||
            value === "LOGISTICS_COMMAND" ||
            value === "SYSTEM");
    }
    isAssignedRoleId(value) {
        return (value === "COMMANDING_OFFICER" ||
            value === "MARINE_ENGINEERING_OFFICER" ||
            value === "WEAPON_ELECTRICAL_OFFICER" ||
            value === "FLEET_SUPPORT_GROUP" ||
            value === "LOGISTICS_COMMAND");
    }
    isApprovalStatus(value) {
        return (value === "DRAFT" ||
            value === "SUBMITTED" ||
            value === "APPROVED" ||
            value === "REJECTED");
    }
    isFleetRecordKind(value) {
        return (value === "MAINTENANCE_LOG" ||
            value === "DEFECT" ||
            value === "WORK_REQUEST");
    }
    isTaskHistoryType(value) {
        return (value === "CREATED" ||
            value === "CHECKED" ||
            value === "STATUS_CHANGED" ||
            value === "REPLANNED" ||
            value === "NOTIFIED" ||
            value === "COMPLETED" ||
            value === "ESCALATED");
    }
    isApprovalHistoryType(value) {
        return (value === "CREATED" ||
            value === "SUBMITTED" ||
            value === "APPROVED" ||
            value === "REJECTED" ||
            value === "INVALID_ATTEMPT" ||
            value === "STALE_REMINDER_SENT");
    }
    isApprovalFlow(value) {
        if (!isRecord(value)) {
            return false;
        }
        return (Array.isArray(value.chain) &&
            value.chain.length >= 2 &&
            value.chain.every((role) => this.isAssignedRoleId(role)) &&
            typeof value.currentStepIndex === "number" &&
            typeof value.approvalLevel === "number" &&
            this.isAssignedRoleId(value.currentOwner) &&
            this.isApprovalStatus(value.status) &&
            isNullableString(value.submittedAt) &&
            isNullableString(value.approvedAt) &&
            isNullableString(value.rejectedAt) &&
            (value.lastActionBy === null || value.lastActionBy === "SYSTEM" || this.isRoleId(value.lastActionBy)) &&
            isNullableString(value.lastActionAt) &&
            isNullableString(value.lastActionReason) &&
            isNullableString(value.lastActionNote) &&
            isNullableString(value.lastStaleNotificationAt) &&
            typeof value.version === "number");
    }
    assertValidFleetRecord(record) {
        if (!this.isFleetRecord(record)) {
            throw new Error("Invalid approval record");
        }
        if (record.approval.chain[0] !== record.originRole) {
            throw new Error("Approval chain must begin with the origin role");
        }
        if (!record.visibleTo.includes(record.originRole)) {
            throw new Error("Approval visibleTo must include the origin role");
        }
        if (!record.visibleTo.includes(record.approval.currentOwner)) {
            throw new Error("Approval visibleTo must include the current owner");
        }
        if (record.approval.currentStepIndex < 0 || record.approval.currentStepIndex >= record.approval.chain.length) {
            throw new Error("Approval currentStepIndex is out of bounds");
        }
        if (record.approval.approvalLevel !== record.approval.currentStepIndex) {
            throw new Error("Approval level must match the current step index");
        }
        if (record.approval.chain[record.approval.currentStepIndex] !== record.approval.currentOwner) {
            throw new Error("Approval currentOwner must match the current chain step");
        }
    }
    getApprovalChainRole(chain, index) {
        const role = chain[index];
        if (!role) {
            throw new Error(`Approval chain role missing at index ${index}`);
        }
        return role;
    }
    getPreviousApprovalOwner(recordId, current) {
        const history = this.approvalHistoryById.get(recordId) ?? [];
        for (let index = history.length - 1; index >= 0; index -= 1) {
            const entry = history[index];
            if (!entry) {
                continue;
            }
            if ((entry.actionType === "SUBMITTED" || entry.actionType === "APPROVED") &&
                entry.newState.currentOwner === current.approval.currentOwner &&
                entry.previousState.currentOwner !== entry.newState.currentOwner) {
                return entry.previousState.currentOwner;
            }
        }
        throw new Error("Approval rejection could not determine a previous owner from history");
    }
    assertValidComplianceSignal(signal) {
        if (!this.isComplianceSignal(signal)) {
            throw new Error("Invalid compliance signal");
        }
        if (signal.shipId) {
            this.assertValidShipId(signal.shipId);
        }
    }
    buildComplianceSignalKey(signal) {
        return [
            signal.type,
            signal.shipId ?? "NO_SHIP",
            signal.taskId ?? "NO_TASK",
            signal.defectId ?? "NO_DEFECT",
        ].join("::");
    }
    compareComplianceSignals(left, right) {
        return (this.compareOptionalString(left.shipId, right.shipId) ||
            this.compareComplianceSeverity(left.severity, right.severity) ||
            left.type.localeCompare(right.type) ||
            this.compareOptionalString(left.taskId, right.taskId) ||
            this.compareOptionalString(left.defectId, right.defectId) ||
            left.message.localeCompare(right.message));
    }
    compareComplianceSeverity(left, right) {
        return this.getComplianceSeverityRank(right) - this.getComplianceSeverityRank(left);
    }
    getComplianceSeverityRank(severity) {
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
    getEventIntegrityState() {
        return {
            processedEvents: Object.fromEntries(this.processedEventsById.entries()),
        };
    }
    replaceProcessedEvents(processedEvents) {
        this.processedEventsById.clear();
        for (const [eventId, processedAt] of Object.entries(processedEvents)) {
            this.processedEventsById.set(eventId, processedAt);
        }
    }
    resetPersistedState() {
        this.shipsById.clear();
        this.tasksById.clear();
        this.taskHistoryById.clear();
        this.recordsById.clear();
        this.approvalHistoryById.clear();
        this.processedTransitions.clear();
        this.processedEventsById.clear();
        this.escalationByDate.clear();
        this.notificationsById.clear();
        this.complianceSignalsByKey.clear();
    }
    persistState() {
        const payload = {
            version: STORE_STATE_VERSION,
            ships: [...this.shipsById.values()],
            tasks: [...this.tasksById.values()],
            taskHistory: [...this.taskHistoryById.entries()],
            records: [...this.recordsById.values()],
            approvalHistory: [...this.approvalHistoryById.entries()],
            processedTransitions: [...this.processedTransitions.entries()],
            processedEvents: Object.fromEntries([...this.processedEventsById.entries()].sort(([leftId], [rightId]) => leftId.localeCompare(rightId))),
            escalationState: [...this.escalationByDate.entries()],
            notifications: [...this.notificationsById.values()],
            complianceSignals: this.getAllComplianceSignals(),
        };
        const serialized = JSON.stringify(payload, null, 2);
        (0, fs_1.mkdirSync)((0, path_1.dirname)(this.persistenceFilePath), { recursive: true });
        try {
            (0, fs_1.writeFileSync)(this.tempFilePath, serialized, "utf8");
            if ((0, fs_1.existsSync)(this.backupFilePath)) {
                (0, fs_1.rmSync)(this.backupFilePath);
            }
            if ((0, fs_1.existsSync)(this.persistenceFilePath)) {
                (0, fs_1.renameSync)(this.persistenceFilePath, this.backupFilePath);
            }
            (0, fs_1.renameSync)(this.tempFilePath, this.persistenceFilePath);
            this.lastPersistenceTimestamp = new Date().toISOString();
        }
        catch (error) {
            if ((0, fs_1.existsSync)(this.tempFilePath)) {
                (0, fs_1.rmSync)(this.tempFilePath);
            }
            logger_1.logger.error("persistence_write_failed", error, {
                result: this.persistenceFilePath,
                status: "WRITE_FAILED",
            });
            throw error;
        }
    }
}
exports.InMemoryStore = InMemoryStore;
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isNullableString(value) {
    return typeof value === "string" || value === null;
}
//# sourceMappingURL=store.js.map