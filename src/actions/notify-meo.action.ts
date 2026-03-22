import { InMemoryStore } from "../core/store";
import { ActionCommand } from "../core/types";

export class NotifyMeoAction {
  execute(command: ActionCommand, store: InMemoryStore): void {
    store.updateComplianceState(command.businessDate, {
      meoNotifiedAt: command.issuedAt,
    });
  }
}
