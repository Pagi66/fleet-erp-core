import { InMemoryStore } from "../core/store";
import { ActionCommand, REQUIRED_DAILY_LOGS } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class MarkComplianceAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId) {
      throw new Error("MARK_COMPLIANT/MARK_NON_COMPLIANT command is missing shipId");
    }
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

    const currentState = store.getOrCreateComplianceState(
      command.shipId,
      command.businessDate,
    );
    const logs = store.getLogsForDate(command.shipId, command.businessDate);
    const presentLogs = logs.map((log) => log.logType);
    const missingLogs = REQUIRED_DAILY_LOGS.filter(
      (logType) => !presentLogs.includes(logType),
    );
    const nextStatus =
      command.type === "MARK_COMPLIANT" ? "COMPLIANT" : "NON_COMPLIANT";
    const sameState =
      currentState.status === nextStatus &&
      currentState.lastEvaluatedAt === command.issuedAt &&
      currentState.presentLogs.length === presentLogs.length &&
      currentState.presentLogs.every((logType) => presentLogs.includes(logType)) &&
      currentState.missingLogs.length === missingLogs.length &&
      currentState.missingLogs.every((logType) => missingLogs.includes(logType));
    if (sameState) {
      return;
    }

    store.updateComplianceState(command.shipId, command.businessDate, {
      presentLogs,
      missingLogs,
      status: nextStatus,
      lastEvaluatedAt: command.issuedAt,
    });
  }
}
