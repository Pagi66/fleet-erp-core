"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PmsTaskRule = void 0;
class PmsTaskRule {
    evaluate(event, store) {
        if (event.type === "PMS_TASK_GENERATE") {
            if (!event.shipId || !event.taskId || !event.taskTitle || !event.dueDate || !event.assignedRole) {
                throw new Error("PMS_TASK_GENERATE event is missing required task fields");
            }
            const existingTask = store.getTaskInShip(event.taskId, event.shipId);
            if (existingTask) {
                return this.createDecision(event, "NO_CHANGE", []);
            }
            return this.createDecision(event, "TASK_CREATED", [
                {
                    type: "CREATE_PMS_TASK",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    taskId: event.taskId,
                    taskTitle: event.taskTitle,
                    dueDate: event.dueDate,
                    assignedRole: event.assignedRole,
                },
            ]);
        }
        if (!event.shipId || !event.taskId) {
            throw new Error("PMS_TASK_CHECK event is missing taskId");
        }
        const snapshot = store.getTaskSnapshotInShip(event.taskId, event.shipId);
        if (!snapshot.task) {
            return this.createDecision(event, "NO_CHANGE", []);
        }
        if (snapshot.task.status === "COMPLETED") {
            return this.createDecision(event, "TASK_COMPLETED", [
                {
                    type: "CHECK_TASK",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    taskId: snapshot.task.id,
                },
            ]);
        }
        const dueTime = Date.parse(snapshot.task.dueDate);
        const checkTime = Date.parse(event.occurredAt);
        if (checkTime <= dueTime) {
            return this.createDecision(event, "NO_CHANGE", [
                {
                    type: "CHECK_TASK",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    taskId: snapshot.task.id,
                },
            ]);
        }
        return this.createDecision(event, "TASK_OVERDUE", [
            {
                type: "CHECK_TASK",
                businessDate: event.businessDate,
                issuedAt: event.occurredAt,
                missingLogs: [],
                shipId: event.shipId,
                taskId: snapshot.task.id,
            },
            {
                type: "MARK_PMS_TASK_OVERDUE",
                businessDate: event.businessDate,
                issuedAt: event.occurredAt,
                missingLogs: [],
                shipId: event.shipId,
                taskId: snapshot.task.id,
            },
            {
                type: "REPLAN_PMS_TASK",
                businessDate: event.businessDate,
                issuedAt: event.occurredAt,
                missingLogs: [],
                shipId: event.shipId,
                taskId: snapshot.task.id,
            },
            {
                type: "NOTIFY_PMS_SUPERVISOR",
                businessDate: event.businessDate,
                issuedAt: event.occurredAt,
                missingLogs: [],
                shipId: event.shipId,
                taskId: snapshot.task.id,
                targetRole: snapshot.task.assignedRole,
            },
        ]);
    }
    createDecision(event, result, commands) {
        return {
            eventType: event.type,
            businessDate: event.businessDate,
            result,
            missingLogs: [],
            commands,
        };
    }
}
exports.PmsTaskRule = PmsTaskRule;
//# sourceMappingURL=pms-task.rule.js.map