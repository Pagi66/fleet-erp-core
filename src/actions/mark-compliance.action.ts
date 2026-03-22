import { InMemoryStore } from "../core/store";
import { ActionCommand, REQUIRED_DAILY_LOGS } from "../core/types";

export class MarkComplianceAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
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
