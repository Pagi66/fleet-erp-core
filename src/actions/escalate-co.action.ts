import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class EscalateCoAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    store.updateEscalationState(command.businessDate, {
      status: "ESCALATED_TO_CO",
      reason: "MISSING_DAILY_LOGS",
      missingLogsAtEscalation: command.missingLogs,
      escalatedAt: command.issuedAt,
      targetRole: "CO",
    });
  }
}
