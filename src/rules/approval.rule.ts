import { InMemoryStore } from "../core/store";
import { ActionCommand, ApprovalHistoryType, AssignedRoleId, EngineEvent, RoleId, RuleDecision } from "../core/types";

const APPROVAL_CHAIN_BY_ORIGIN: Record<AssignedRoleId, AssignedRoleId[]> = {
  MARINE_ENGINEERING_OFFICER: [
    "MARINE_ENGINEERING_OFFICER",
    "COMMANDING_OFFICER",
    "FLEET_SUPPORT_GROUP",
    "LOGISTICS_COMMAND",
  ],
  WEAPON_ELECTRICAL_OFFICER: [
    "WEAPON_ELECTRICAL_OFFICER",
    "COMMANDING_OFFICER",
    "FLEET_SUPPORT_GROUP",
    "LOGISTICS_COMMAND",
  ],
  COMMANDING_OFFICER: [
    "COMMANDING_OFFICER",
    "FLEET_SUPPORT_GROUP",
    "LOGISTICS_COMMAND",
  ],
  FLEET_SUPPORT_GROUP: [
    "FLEET_SUPPORT_GROUP",
    "LOGISTICS_COMMAND",
  ],
  LOGISTICS_COMMAND: [
    "LOGISTICS_COMMAND",
    "LOGISTICS_COMMAND",
  ],
};

export class ApprovalRule {
  evaluate(event: EngineEvent, store: InMemoryStore): RuleDecision {
    switch (event.type) {
      case "APPROVAL_RECORD_CREATE":
        return this.handleCreate(event, store);
      case "APPROVAL_RECORD_SUBMIT":
        return this.handleSubmit(event, store);
      case "APPROVAL_RECORD_APPROVE":
        return this.handleApprove(event, store);
      case "APPROVAL_RECORD_REJECT":
        return this.handleReject(event, store);
      case "APPROVAL_RECORD_STALE_CHECK":
        return this.handleStaleCheck(event, store);
      default: {
        throw new Error(`Unsupported approval event: ${event.type}`);
      }
    }
  }

  private handleCreate(event: EngineEvent, store: InMemoryStore): RuleDecision {
    if (
      !event.shipId ||
      !event.recordId ||
      !event.recordKind ||
      !event.recordTitle ||
      !event.actor
    ) {
      throw new Error("APPROVAL_RECORD_CREATE is missing required fields");
    }

    const existing = store.getApprovalRecordInShip(event.recordId, event.shipId);
    if (existing) {
      return this.createDecision(event, "NO_CHANGE", []);
    }

    const actor = event.actor;
    const originRole = this.asOriginRole(event.actor);
    const chain = APPROVAL_CHAIN_BY_ORIGIN[originRole];
    const commands: ActionCommand[] = [
      {
        type: "CREATE_APPROVAL_RECORD",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId,
        actor,
        recordId: event.recordId,
        recordKind: event.recordKind,
        recordTitle: event.recordTitle,
        originRole,
        currentOwner: originRole,
        ...(typeof event.description === "string" ? { description: event.description } : {}),
        ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
      },
    ];

    if (chain.length > 1) {
      commands.push({
        type: "NOTIFY_APPROVAL_OWNER",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId,
        actor: "SYSTEM",
        recordId: event.recordId,
        recordTitle: event.recordTitle,
        currentOwner: originRole,
        notificationType: "APPROVAL_PENDING",
        reason: "Record created in draft",
      });
    }

    return this.createDecision(event, "RECORD_CREATED", commands);
  }

  private handleSubmit(event: EngineEvent, store: InMemoryStore): RuleDecision {
    if (!event.shipId || !event.recordId) {
      throw new Error("APPROVAL_RECORD_SUBMIT is missing record fields");
    }

    const record = store.getApprovalRecordInShip(event.recordId, event.shipId);
    if (!record) {
      return this.createDecision(event, "NO_CHANGE", []);
    }

    const transitionId = this.getTransitionId(event);
    const actor = this.requireActor(event);
    const identityDecision = this.getTransitionIdentityDecision(
      store,
      event,
      record.id,
      event.shipId,
      actor,
      transitionId,
      "SUBMITTED",
    );
    if (identityDecision) {
      return identityDecision;
    }
    if (record.approval.status === "APPROVED" || record.approval.status === "REJECTED") {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        `Transition blocked in terminal state: ${record.approval.status}`,
      );
    }
    if (record.approval.status !== "DRAFT") {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        `Invalid approval status transition: ${record.approval.status} -> SUBMITTED`,
      );
    }
    if (record.approval.currentOwner !== actor) {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        "Only the current owner may submit the record",
      );
    }
    const nextIndex = record.approval.currentStepIndex + 1;
    if (nextIndex >= record.approval.chain.length) {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        "Approval chain has no next owner for submit",
      );
    }
    const nextOwner = this.getChainRole(record.approval.chain, nextIndex);
    return this.createDecision(event, "RECORD_SUBMITTED", [
      {
        type: "SUBMIT_APPROVAL_RECORD",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId,
        actor,
        recordId: record.id,
        transitionId,
        ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
        ...(typeof event.note === "string" ? { note: event.note } : {}),
      },
      {
        type: "NOTIFY_APPROVAL_OWNER",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId,
        actor: "SYSTEM",
        recordId: record.id,
        recordTitle: record.title,
        currentOwner: nextOwner,
        notificationType: "APPROVAL_PENDING",
        transitionId,
        reason: "Approval pending",
        ...(typeof event.note === "string" ? { note: event.note } : {}),
      },
    ]);
  }

  private handleApprove(event: EngineEvent, store: InMemoryStore): RuleDecision {
    if (!event.shipId || !event.recordId) {
      throw new Error("APPROVAL_RECORD_APPROVE is missing record fields");
    }

    const record = store.getApprovalRecordInShip(event.recordId, event.shipId);
    if (!record) {
      return this.createDecision(event, "NO_CHANGE", []);
    }

    const transitionId = this.getTransitionId(event);
    const actor = this.requireActor(event);
    const identityDecision = this.getTransitionIdentityDecision(
      store,
      event,
      record.id,
      event.shipId,
      actor,
      transitionId,
      "APPROVED",
    );
    if (identityDecision) {
      return identityDecision;
    }
    if (record.approval.status === "APPROVED" || record.approval.status === "REJECTED") {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        `Transition blocked in terminal state: ${record.approval.status}`,
      );
    }
    if (record.approval.status !== "SUBMITTED") {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        `Invalid approval status transition: ${record.approval.status} -> APPROVED`,
      );
    }
    if (record.approval.currentOwner !== actor) {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        "Only the current owner may approve the record",
      );
    }
    const isFinalStep = record.approval.currentStepIndex === record.approval.chain.length - 1;
    const commands: ActionCommand[] = [
      {
        type: "APPROVE_APPROVAL_RECORD",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId,
        actor,
        recordId: record.id,
        transitionId,
        ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
        ...(typeof event.note === "string" ? { note: event.note } : {}),
      },
    ];

    if (!isFinalStep) {
      const nextOwner = this.getChainRole(record.approval.chain, record.approval.currentStepIndex + 1);
      commands.push({
        type: "NOTIFY_APPROVAL_OWNER",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId,
        actor: "SYSTEM",
        recordId: record.id,
        recordTitle: record.title,
        currentOwner: nextOwner,
        notificationType: "APPROVAL_PENDING",
        transitionId,
        reason: "Approval advanced",
        ...(typeof event.note === "string" ? { note: event.note } : {}),
      });
    }

    return this.createDecision(event, "RECORD_APPROVED", commands);
  }

  private handleReject(event: EngineEvent, store: InMemoryStore): RuleDecision {
    if (!event.shipId || !event.recordId) {
      throw new Error("APPROVAL_RECORD_REJECT is missing record fields");
    }

    const record = store.getApprovalRecordInShip(event.recordId, event.shipId);
    if (!record) {
      return this.createDecision(event, "NO_CHANGE", []);
    }

    const transitionId = this.getTransitionId(event);
    const actor = this.requireActor(event);
    const identityDecision = this.getTransitionIdentityDecision(
      store,
      event,
      record.id,
      event.shipId,
      actor,
      transitionId,
      "REJECTED",
    );
    if (identityDecision) {
      return identityDecision;
    }
    if (record.approval.status === "APPROVED" || record.approval.status === "REJECTED") {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        `Transition blocked in terminal state: ${record.approval.status}`,
      );
    }
    if (record.approval.status !== "SUBMITTED") {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        `Invalid approval status transition: ${record.approval.status} -> REJECTED`,
      );
    }
    if (record.approval.currentOwner !== actor) {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        "Only the current owner may reject the record",
      );
    }
    if (record.approval.currentStepIndex === 0) {
      return this.createInvalidAttemptDecision(
        event,
        record.id,
        event.shipId,
        actor,
        transitionId,
        "Approval chain has no lower owner for rejection",
      );
    }
    const previousOwner = store.getPreviousApprovalOwnerInShip(record.id, event.shipId);

    return this.createDecision(event, "RECORD_REJECTED", [
      {
        type: "REJECT_APPROVAL_RECORD",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId,
        actor,
        recordId: record.id,
        transitionId,
        ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
        ...(typeof event.note === "string" ? { note: event.note } : {}),
      },
      {
        type: "NOTIFY_APPROVAL_OWNER",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId,
        actor: "SYSTEM",
        recordId: record.id,
        recordTitle: record.title,
        currentOwner: previousOwner,
        notificationType: "APPROVAL_PENDING",
        transitionId,
        reason: event.reason ?? "Approval rejected",
        ...(typeof event.note === "string" ? { note: event.note } : {}),
      },
    ]);
  }

  private handleStaleCheck(event: EngineEvent, store: InMemoryStore): RuleDecision {
    if (!event.shipId) {
      throw new Error("APPROVAL_RECORD_STALE_CHECK is missing shipId");
    }

    const thresholdHours = event.staleThresholdHours ?? 24;
    const staleRecords = store.getStaleApprovalRecordsByShip(
      event.shipId,
      event.occurredAt,
      thresholdHours,
    );

    if (staleRecords.length === 0) {
      return this.createDecision(event, "NO_CHANGE", []);
    }

    return this.createDecision(
      event,
      "RECORD_NOTIFIED",
      staleRecords.map((record) => ({
        type: "NOTIFY_APPROVAL_OWNER",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId: event.shipId as string,
        actor: "SYSTEM",
        recordId: record.id,
        recordTitle: record.title,
        currentOwner: record.approval.currentOwner,
        notificationType: "APPROVAL_STALE",
        reason: `No action for ${thresholdHours} hours`,
      })),
    );
  }

  private createDecision(
    event: EngineEvent,
    result: RuleDecision["result"],
    commands: ActionCommand[],
  ): RuleDecision {
    return {
      eventType: event.type,
      businessDate: event.businessDate,
      result,
      missingLogs: [],
      commands,
    };
  }

  private createInvalidAttemptDecision(
    event: EngineEvent,
    recordId: string,
    shipId: string,
    actor: RoleId,
    transitionId: string,
    reason: string,
  ): RuleDecision {
    return this.createDecision(event, "NO_CHANGE", [
      {
        type: "AUDIT_APPROVAL_INVALID_ATTEMPT",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        shipId,
        actor,
        recordId,
        transitionId,
        reason,
        ...(typeof event.note === "string" ? { note: event.note } : {}),
      },
    ]);
  }

  private getTransitionIdentityDecision(
    store: InMemoryStore,
    event: EngineEvent,
    recordId: string,
    shipId: string,
    actor: RoleId,
    transitionId: string,
    actionType: ApprovalHistoryType,
  ): RuleDecision | null {
    const processed = store.getProcessedApprovalTransition(transitionId);
    if (!processed) {
      return null;
    }

    if (processed.recordId === recordId && processed.actionType === actionType) {
      return this.createDecision(event, "NO_CHANGE", []);
    }

    return this.createInvalidAttemptDecision(
      event,
      recordId,
      shipId,
      actor,
      transitionId,
      "Transition ID already used for a different approval action",
    );
  }

  private getTransitionId(event: EngineEvent): string {
    return (
      event.transitionId ??
      `${event.type}:${event.shipId ?? "NO_SHIP"}:${event.recordId ?? "NO_RECORD"}:${event.actor ?? "SYSTEM"}:${event.occurredAt}`
    );
  }

  private asOriginRole(actor: EngineEvent["actor"]): AssignedRoleId {
    if (actor === "MARINE_ENGINEERING_OFFICER" || actor === "WEAPON_ELECTRICAL_OFFICER") {
      return actor;
    }
    throw new Error("Approval records may only originate from MEO or WEO");
  }

  private requireActor(event: EngineEvent): RoleId {
    if (!event.actor) {
      throw new Error(`${event.type} requires actor`);
    }
    return event.actor;
  }

  private getChainRole(chain: AssignedRoleId[], index: number): AssignedRoleId {
    const role = chain[index];
    if (!role) {
      throw new Error(`Approval chain role missing at index ${index}`);
    }
    return role;
  }
}
