import { EngineEvent, FleetRecordKind, RoleId } from "../core/types";

export function createApprovalRecordCreateEvent(
  shipId: string,
  recordId: string,
  recordKind: FleetRecordKind,
  recordTitle: string,
  businessDate: string,
  occurredAt: string,
  actor: RoleId,
  description?: string,
): EngineEvent {
  return {
    type: "APPROVAL_RECORD_CREATE",
    shipId,
    recordId,
    recordKind,
    recordTitle,
    businessDate,
    occurredAt,
    actor,
    ...(typeof description === "string" ? { description } : {}),
  };
}

export function createApprovalTransitionEvent(
  type: "APPROVAL_RECORD_SUBMIT" | "APPROVAL_RECORD_APPROVE" | "APPROVAL_RECORD_REJECT",
  shipId: string,
  recordId: string,
  businessDate: string,
  occurredAt: string,
  actor: RoleId,
  transitionId?: string,
  reason?: string,
  note?: string,
): EngineEvent {
  return {
    type,
    shipId,
    recordId,
    businessDate,
    occurredAt,
    actor,
    ...(typeof transitionId === "string" ? { transitionId } : {}),
    ...(typeof reason === "string" ? { reason } : {}),
    ...(typeof note === "string" ? { note } : {}),
  };
}

export function createApprovalStaleCheckEvent(
  shipId: string,
  businessDate: string,
  occurredAt: string,
  staleThresholdHours: number,
): EngineEvent {
  return {
    type: "APPROVAL_RECORD_STALE_CHECK",
    shipId,
    businessDate,
    occurredAt,
    staleThresholdHours,
  };
}
