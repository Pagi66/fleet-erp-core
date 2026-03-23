import pino = require("pino");

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
});

interface LogFields {
  eventType?: string;
  taskId?: string;
  actionType?: string;
  result?: string;
  status?: string;
}

export const logger = {
  eventReceived(fields: LogFields): void {
    baseLogger.info(fields, "event_received");
  },

  ruleDecision(fields: LogFields): void {
    baseLogger.info(fields, "rule_decision");
  },

  actionExecution(fields: LogFields): void {
    baseLogger.info(fields, "action_execution");
  },

  stateChange(fields: LogFields): void {
    baseLogger.info(fields, "state_change");
  },

  warn(message: string, fields: LogFields = {}): void {
    baseLogger.warn(fields, message);
  },

  error(message: string, error: unknown, fields: LogFields = {}): void {
    baseLogger.error(
      {
        ...fields,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
      },
      message,
    );
  },
};
