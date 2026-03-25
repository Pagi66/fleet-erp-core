"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineScheduler = void 0;
const node_cron_1 = require("node-cron");
const approval_events_1 = require("./approval-events");
const log_events_1 = require("./log-events");
const defect_events_1 = require("./defect-events");
const pms_events_1 = require("./pms-events");
class EngineScheduler {
    constructor(eventBus, getShipIds) {
        this.eventBus = eventBus;
        this.getShipIds = getShipIds;
        this.tasks = [];
    }
    start() {
        this.tasks.push(node_cron_1.default.schedule("59 23 * * *", () => {
            const now = new Date();
            const businessDate = formatDate(now);
            for (const shipId of this.getShipIds()) {
                this.eventBus.emit({
                    ...(0, log_events_1.createDailyLogCheckDueEvent)(businessDate, now.toISOString()),
                    shipId,
                    actor: "SYSTEM",
                });
            }
        }));
        this.tasks.push(node_cron_1.default.schedule("0 8 * * *", () => {
            const now = new Date();
            const businessDate = formatDate(previousDay(now));
            for (const shipId of this.getShipIds()) {
                this.eventBus.emit({
                    ...(0, log_events_1.createDailyLogEscalationDueEvent)(businessDate, now.toISOString()),
                    shipId,
                    actor: "SYSTEM",
                });
            }
        }));
        this.tasks.push(node_cron_1.default.schedule("0 * * * *", () => {
            const now = new Date();
            const businessDate = formatDate(now);
            for (const shipId of this.getShipIds()) {
                this.eventBus.emit({
                    ...(0, approval_events_1.createApprovalStaleCheckEvent)(shipId, businessDate, now.toISOString(), EngineScheduler.APPROVAL_STALE_THRESHOLD_HOURS),
                    actor: "SYSTEM",
                });
            }
        }));
    }
    stop() {
        for (const task of this.tasks) {
            task.stop();
            task.destroy();
        }
        this.tasks.length = 0;
    }
    triggerEndOfDayCheck(shipId, businessDate, occurredAt) {
        this.eventBus.emit({
            ...(0, log_events_1.createDailyLogCheckDueEvent)(businessDate, occurredAt ?? new Date().toISOString()),
            shipId,
            actor: "SYSTEM",
        });
    }
    triggerMorningEscalation(shipId, businessDate, occurredAt) {
        this.eventBus.emit({
            ...(0, log_events_1.createDailyLogEscalationDueEvent)(businessDate, occurredAt ?? new Date().toISOString()),
            shipId,
            actor: "SYSTEM",
        });
    }
    triggerPmsTaskGenerate(shipId, taskId, taskTitle, businessDate, dueDate, assignedRole, occurredAt) {
        this.eventBus.emit({
            ...(0, pms_events_1.createPmsTaskGenerateEvent)(shipId, taskId, taskTitle, businessDate, dueDate, assignedRole, occurredAt ?? new Date().toISOString()),
            actor: "SYSTEM",
        });
    }
    triggerPmsTaskCheck(shipId, taskId, businessDate, occurredAt) {
        this.eventBus.emit({
            ...(0, pms_events_1.createPmsTaskCheckEvent)(shipId, taskId, businessDate, occurredAt ?? new Date().toISOString()),
            actor: "SYSTEM",
        });
    }
    triggerDefectReported(shipId, taskId, taskTitle, businessDate, ettrDays, severity, occurredAt) {
        this.eventBus.emit({
            ...(0, defect_events_1.createDefectReportedEvent)(shipId, taskId, taskTitle, businessDate, ettrDays, severity, occurredAt ?? new Date().toISOString()),
            actor: "SYSTEM",
        });
    }
    triggerDefectEvaluation(shipId, taskId, businessDate, occurredAt) {
        this.eventBus.emit({
            ...(0, defect_events_1.createDefectEvaluationEvent)(shipId, taskId, businessDate, occurredAt ?? new Date().toISOString()),
            actor: "SYSTEM",
        });
    }
    triggerApprovalStaleCheck(shipId, businessDate, occurredAt, staleThresholdHours = EngineScheduler.APPROVAL_STALE_THRESHOLD_HOURS) {
        this.eventBus.emit({
            ...(0, approval_events_1.createApprovalStaleCheckEvent)(shipId, businessDate, occurredAt ?? new Date().toISOString(), staleThresholdHours),
            actor: "SYSTEM",
        });
    }
}
exports.EngineScheduler = EngineScheduler;
EngineScheduler.APPROVAL_STALE_THRESHOLD_HOURS = 24;
function previousDay(date) {
    const result = new Date(date);
    result.setDate(result.getDate() - 1);
    return result;
}
function formatDate(date) {
    return date.toISOString().slice(0, 10);
}
//# sourceMappingURL=scheduler.js.map