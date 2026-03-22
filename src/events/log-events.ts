import { AppEvent } from "./event-system";

export function createDailyLogCheckDueEvent(
  businessDate: string,
  occurredAt: string
): AppEvent {
  return {
    name: "DAILY_LOG_CHECK_DUE",
    occurredAt,
    payload: {
      businessDate,
    },
  };
}

export function createDailyLogEscalationDueEvent(
  businessDate: string,
  occurredAt: string
): AppEvent {
  return {
    name: "DAILY_LOG_ESCALATION_DUE",
    occurredAt,
    payload: {
      businessDate,
    },
  };
}
