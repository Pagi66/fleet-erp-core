import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class EscalateCoAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId) {
      throw new Error("ESCALATE_TO_CO command is missing shipId");
    }
    if (!command.actor) {
      throw new Error("ESCALATE_TO_CO command is missing actor");
    }
    if (!canExecuteAction(command.actor, command, null)) {
      logger.warn("rbac_rejected_action", {
        actionType: command.type,
        status: command.actor,
      });
      throw new Error("Actor is not authorized to escalate to COMMANDING_OFFICER");
    }

    const currentState = store.getOrCreateEscalationState(
      command.shipId,
      command.businessDate,
    );
    if (currentState.status === "ESCALATED_TO_CO") {
      return;
    }

    store.updateEscalationState(command.shipId, command.businessDate, {
      status: "ESCALATED_TO_CO",
      reason: "MISSING_DAILY_LOGS",
      missingLogsAtEscalation: command.missingLogs,
      escalatedAt: command.issuedAt,
      targetRole: "COMMANDING_OFFICER",
    });
    store.createNotification({
      type: "ESCALATION",
      shipId: command.shipId,
      taskId: null,
      message: `Daily log escalation for ${command.businessDate}`,
      targetRole: "COMMANDING_OFFICER",
      timestamp: command.issuedAt,
    });
  }
}
