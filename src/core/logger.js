"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino = require("pino");
const config_1 = require("./config");
const baseLogger = pino({
    level: config_1.config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
});
exports.logger = {
    eventReceived(fields) {
        baseLogger.info(fields, "event_received");
    },
    ruleDecision(fields) {
        baseLogger.info(fields, "rule_decision");
    },
    actionExecution(fields) {
        baseLogger.info(fields, "action_execution");
    },
    stateChange(fields) {
        baseLogger.info(fields, "state_change");
    },
    warn(message, fields = {}) {
        baseLogger.warn(fields, message);
    },
    error(message, error, fields = {}) {
        baseLogger.error({
            ...fields,
            error: error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : error,
        }, message);
    },
};
//# sourceMappingURL=logger.js.map