import { InMemoryStore } from "../core/store";
import { ActionCommand, Defect } from "../core/types";
import { logger } from "../core/logger";
import { canExecuteAction } from "../core/rbac";

export class CreateDefectAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    if (!command.shipId || !command.defectId || !command.iss || !command.equipment) {
      throw new Error("CREATE_DEFECT command is missing required defect fields");
    }
    if (!command.actor) {
      throw new Error("CREATE_DEFECT command is missing actor");
    }

    if (!canExecuteAction(command.actor, command, null)) {
      logger.warn("rbac_rejected_action", {
        actionType: command.type,
        status: command.actor,
      });
      throw new Error("Actor is not authorized to create defects");
    }

    if (store.getDefect(command.defectId)) {
      return;
    }

    const defect: Defect = {
      id: command.defectId,
      shipId: command.shipId,
      systemGroup: command.systemGroup ?? "GENERAL_ENGINEERING",
      iss: command.iss,
      equipment: command.equipment,
      description: command.defectDescription ?? command.taskTitle ?? command.equipment,
      classification: command.defectClassification ?? "UNSCHEDULED",
      operationalImpact: command.operationalImpact ?? "Operational impact assessment pending",
      reportedBy: command.reportedBy ?? command.actor,
      status: "OPEN",
      ...(typeof command.ettrDays === "number" ? { ettr: command.ettrDays } : {}),
      ...(command.repairLevel ? { repairLevel: command.repairLevel } : {}),
    };

    store.createDefect(defect);
  }
}
