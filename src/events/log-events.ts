import { EngineEvent } from "../core/types";

export function createDailyLogCheckDueEvent(
  businessDate: string,
  occurredAt: string
): EngineEvent {
  return {
    type: "DAILY_LOG_CHECK_DUE",
    businessDate,
    occurredAt,
  };
}

export function createDailyLogEscalationDueEvent(
  businessDate: string,
  occurredAt: string
): EngineEvent {
  return {
    type: "DAILY_LOG_ESCALATION_DUE",
    businessDate,
    occurredAt,
  };
}
