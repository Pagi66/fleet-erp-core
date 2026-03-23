import {
  ActionCommand,
  EngineEvent,
  LogRecord,
  LogType,
  REQUIRED_DAILY_LOGS,
  RuleDecision,
} from "../core/types";
import { InMemoryStore } from "../core/store";

export class DailyLogRule {
  evaluate(event: EngineEvent, store: InMemoryStore): RuleDecision {
    if (!event.shipId) {
      throw new Error("Daily log event is missing shipId");
    }

    const snapshot = store.getSnapshot(event.shipId, event.businessDate);
    const presentLogs = this.collectPresentLogs(snapshot.logs);
    const missingLogs = REQUIRED_DAILY_LOGS.filter(
      (logType) => !presentLogs.includes(logType),
    );

    if (event.type === "DAILY_LOG_CHECK_DUE") {
      if (missingLogs.length === 0) {
        return this.createDecision(event, "COMPLIANT", [], [
          this.createCommand("MARK_COMPLIANT", event, []),
        ]);
      }

      return this.createDecision(event, "NON_COMPLIANT", missingLogs, [
        this.createCommand("MARK_NON_COMPLIANT", event, missingLogs),
        this.createCommand(
          "NOTIFY_MEO",
          event,
          missingLogs,
          "MARINE_ENGINEERING_OFFICER",
        ),
      ]);
    }

    if (missingLogs.length === 0) {
      return this.createDecision(event, "COMPLIANT", [], [
        this.createCommand("MARK_COMPLIANT", event, []),
      ]);
    }

    if (snapshot.escalationState.status === "ESCALATED_TO_CO") {
      return this.createDecision(event, "NO_CHANGE", missingLogs, []);
    }

    return this.createDecision(event, "ESCALATE", missingLogs, [
      this.createCommand(
        "ESCALATE_TO_CO",
        event,
        missingLogs,
        "COMMANDING_OFFICER",
      ),
    ]);
  }

  private collectPresentLogs(logs: LogRecord[]): LogType[] {
    const present = new Set<LogType>();
    for (const log of logs) {
      present.add(log.logType);
    }
    return [...present];
  }

  private createCommand(
    type: ActionCommand["type"],
    event: EngineEvent,
    missingLogs: LogType[],
    targetRole?: ActionCommand["targetRole"],
  ): ActionCommand {
    return {
      type,
      businessDate: event.businessDate,
      issuedAt: event.occurredAt,
      missingLogs,
      shipId: event.shipId!,
      ...(targetRole ? { targetRole } : {}),
    };
  }

  private createDecision(
    event: EngineEvent,
    result: RuleDecision["result"],
    missingLogs: LogType[],
    commands: ActionCommand[],
  ): RuleDecision {
    return {
      eventType: event.type,
      businessDate: event.businessDate,
      result,
      missingLogs,
      commands,
    };
  }
}
