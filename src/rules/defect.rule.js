"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefectRule = void 0;
class DefectRule {
    evaluate(event, store) {
        if (event.type === "DEFECT_REPORTED") {
            if (!event.shipId || !event.taskId || !event.taskTitle) {
                throw new Error("DEFECT_REPORTED event is missing task fields");
            }
            const defectId = event.taskId;
            const existingDefect = store.getDefect(defectId);
            const existingTask = store.getTaskInShip(event.taskId, event.shipId);
            if (existingTask && existingDefect) {
                return this.createDecision(event, "NO_CHANGE", []);
            }
            const commands = [];
            if (!existingDefect) {
                commands.push({
                    type: "CREATE_DEFECT",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    defectId,
                    iss: event.iss ?? "0000",
                    equipment: event.equipment ?? event.taskTitle,
                    taskTitle: event.taskTitle,
                    defectDescription: event.description ?? event.taskTitle,
                    defectClassification: event.severity === "CRITICAL" ? "IMMEDIATE" : "UNSCHEDULED",
                    operationalImpact: event.description ?? "Operational impact assessment pending",
                    reportedBy: event.actor ?? "SYSTEM",
                    ...(typeof event.ettrDays === "number" ? { ettrDays: event.ettrDays } : {}),
                    ...(event.ettrDays && event.ettrDays > 21 ? { repairLevel: "DLM" } : {}),
                });
            }
            if (!existingTask) {
                commands.push({
                    type: "CREATE_DEFECT_TASK",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    defectId,
                    taskId: event.taskId,
                    taskTitle: event.taskTitle,
                    taskKind: "DEFECT",
                    assignedRole: "MARINE_ENGINEERING_OFFICER",
                    ...(typeof event.ettrDays === "number" ? { ettrDays: event.ettrDays } : {}),
                    ...(typeof event.severity !== "undefined"
                        ? { severity: event.severity }
                        : {}),
                });
            }
            if (event.severity === "CRITICAL") {
                commands.push({
                    type: "ESCALATE_DEFECT_TO_MCC",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    taskId: event.taskId,
                    targetRole: "FLEET_SUPPORT_GROUP",
                });
            }
            return this.createDecision(event, "TASK_CREATED", commands);
        }
        if (!event.shipId || !event.taskId) {
            throw new Error("DEFECT_EVALUATION event is missing taskId");
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
        if (snapshot.task.severity === "CRITICAL") {
            if (snapshot.task.escalationLevel === "LOG_COMD") {
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
            const actionType = snapshot.task.escalationLevel === "MCC"
                ? "ESCALATE_DEFECT_TO_LOG_COMD"
                : "ESCALATE_DEFECT_TO_MCC";
            return this.createDecision(event, "TASK_ESCALATED", [
                {
                    type: "CHECK_TASK",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    taskId: snapshot.task.id,
                },
                {
                    type: actionType,
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    taskId: snapshot.task.id,
                    targetRole: actionType === "ESCALATE_DEFECT_TO_MCC"
                        ? "FLEET_SUPPORT_GROUP"
                        : "LOGISTICS_COMMAND",
                },
            ]);
        }
        if ((snapshot.task.ettrDays ?? 0) > 21) {
            if (snapshot.task.escalationLevel === "LOG_COMD") {
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
            return this.createDecision(event, "TASK_ESCALATED", [
                {
                    type: "CHECK_TASK",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    taskId: snapshot.task.id,
                },
                {
                    type: "ESCALATE_DEFECT_TO_LOG_COMD",
                    businessDate: event.businessDate,
                    issuedAt: event.occurredAt,
                    missingLogs: [],
                    shipId: event.shipId,
                    taskId: snapshot.task.id,
                    targetRole: "LOGISTICS_COMMAND",
                },
            ]);
        }
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
exports.DefectRule = DefectRule;
//# sourceMappingURL=defect.rule.js.map