import { InMemoryStore } from "../core/store";
import { ActionCommand, REQUIRED_DAILY_LOGS } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class MarkComplianceAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.actor) {
      throw new Error("MARK_COMPLIANT/MARK_NON_COMPLIANT command is missing actor");
    }
    if (!canExecuteAction(command.actor, command, null)) {
      logger.warn("rbac_rejected_action", {
        actionType: command.type,
        status: command.actor,
      });
      throw new Error("Actor is not authorized to update compliance state");
    }

    const logs = store.getLogsForDate(command.businessDate);
    const presentLogs = logs.map((log) => log.logType);
    const missingLogs = REQUIRED_DAILY_LOGS.filter(
      (logType) => !presentLogs.includes(logType),
    );

    store.updateComplianceState(command.businessDate, {
      presentLogs,
      missingLogs,
      status: command.type === "MARK_COMPLIANT" ? "COMPLIANT" : "NON_COMPLIANT",
      lastEvaluatedAt: command.issuedAt,
    });
  }
}
