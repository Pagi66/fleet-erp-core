"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateDefectAction = void 0;
const logger_1 = require("../core/logger");
const rbac_1 = require("../core/rbac");
class CreateDefectAction {
    execute(command, store) {
        if (!command.shipId || !command.defectId || !command.iss || !command.equipment) {
            throw new Error("CREATE_DEFECT command is missing required defect fields");
        }
        if (!command.actor) {
            throw new Error("CREATE_DEFECT command is missing actor");
        }
        if (!(0, rbac_1.canExecuteAction)(command.actor, command, null)) {
            logger_1.logger.warn("rbac_rejected_action", {
                actionType: command.type,
                status: command.actor,
            });
            throw new Error("Actor is not authorized to create defects");
        }
        if (store.getDefect(command.defectId)) {
            return;
        }
        const defect = {
            id: command.defectId,
            shipId: command.shipId,
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
exports.CreateDefectAction = CreateDefectAction;
//# sourceMappingURL=create-defect.action.js.map