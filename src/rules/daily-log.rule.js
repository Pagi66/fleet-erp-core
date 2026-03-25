"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailyLogRule = void 0;
const types_1 = require("../core/types");
class DailyLogRule {
    evaluate(event, store) {
        if (!event.shipId) {
            throw new Error("Daily log event is missing shipId");
        }
        const snapshot = store.getSnapshot(event.shipId, event.businessDate);
        const presentLogs = this.collectPresentLogs(snapshot.logs);
        const missingLogs = types_1.REQUIRED_DAILY_LOGS.filter((logType) => !presentLogs.includes(logType));
        if (event.type === "DAILY_LOG_CHECK_DUE") {
            if (missingLogs.length === 0) {
                return this.createDecision(event, "COMPLIANT", [], [
                    this.createCommand("MARK_COMPLIANT", event, []),
                ]);
            }
            return this.createDecision(event, "NON_COMPLIANT", missingLogs, [
                this.createCommand("MARK_NON_COMPLIANT", event, missingLogs),
                this.createCommand("NOTIFY_MEO", event, missingLogs, "MARINE_ENGINEERING_OFFICER"),
            ]);
        }
        if (missingLogs.length === 0) {
            return this.createDecision(event, "COMPLIANT", [], [
                this.createCommand("MARK_COMPLIANT", event, []),
            ]);
        }
        if (snapshot.escalationState.status === "ESCALATED_TO_CO") {
            return this.createDecision(event, "NO_CHANGE", missingLogs, []);
        }
        return this.createDecision(event, "ESCALATE", missingLogs, [
            this.createCommand("ESCALATE_TO_CO", event, missingLogs, "COMMANDING_OFFICER"),
        ]);
    }
    collectPresentLogs(logs) {
        const present = new Set();
        for (const log of logs) {
            present.add(log.logType);
        }
        return [...present];
    }
    createCommand(type, event, missingLogs, targetRole) {
        return {
            type,
            businessDate: event.businessDate,
            issuedAt: event.occurredAt,
            missingLogs,
            shipId: event.shipId,
            ...(targetRole ? { targetRole } : {}),
        };
    }
    createDecision(event, result, missingLogs, commands) {
        return {
            eventType: event.type,
            businessDate: event.businessDate,
            result,
            missingLogs,
            commands,
        };
    }
}
exports.DailyLogRule = DailyLogRule;
//# sourceMappingURL=daily-log.rule.js.map