import { strict as assert } from "assert";
import { createApprovalTransitionEvent } from "../../src/events/approval-events";
import { withScenarioApp, logScenario } from "./helpers";

const SCENARIO = "approval-flow";

export async function runScenario(): Promise<void> {
  await withScenarioApp(SCENARIO, (app) => {
    const shipId = "NNS-ALPHA";
    const recordId = "FLOW-001";
    const businessDate = "2026-03-20";

    logScenario(SCENARIO, "running full approval flow");
    app.eventBus.emit({
      type: "APPROVAL_RECORD_CREATE",
      shipId,
      recordId,
      recordKind: "WORK_REQUEST",
      recordTitle: "Main propulsion repair package",
      businessDate,
      occurredAt: "2026-03-20T08:00:00.000Z",
      actor: "MARINE_ENGINEERING_OFFICER",
    });

    let view = app.store.getApprovalRecordViewInShip(recordId, shipId);
    assert.equal(view.record?.approval.currentOwner, "MARINE_ENGINEERING_OFFICER");
    assert.equal(view.record?.approval.status, "DRAFT");

    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_SUBMIT",
        shipId,
        recordId,
        businessDate,
        "2026-03-20T09:00:00.000Z",
        "MARINE_ENGINEERING_OFFICER",
        "FLOW-001-submit",
      ),
    );
    view = app.store.getApprovalRecordViewInShip(recordId, shipId);
    assert.equal(view.record?.approval.currentOwner, "FLEET_SUPPORT_GROUP");
    assert.equal(view.record?.approval.status, "SUBMITTED");

    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_APPROVE",
        shipId,
        recordId,
        businessDate,
        "2026-03-20T10:00:00.000Z",
        "FLEET_SUPPORT_GROUP",
        "FLOW-001-approve-fsg",
      ),
    );
    view = app.store.getApprovalRecordViewInShip(recordId, shipId);
    assert.equal(view.record?.approval.currentOwner, "LOGISTICS_COMMAND");

    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_APPROVE",
        shipId,
        recordId,
        businessDate,
        "2026-03-20T11:00:00.000Z",
        "LOGISTICS_COMMAND",
        "FLOW-001-approve-log",
      ),
    );
    view = app.store.getApprovalRecordViewInShip(recordId, shipId);
    assert.equal(view.record?.approval.status, "APPROVED");
    assert.equal(view.record?.approval.currentOwner, "LOGISTICS_COMMAND");
    assert.equal(view.history.length, 4);
    assert.deepEqual(
      view.history.map((entry) => entry.actionType),
      ["CREATED", "SUBMITTED", "APPROVED", "APPROVED"],
    );

    logScenario(SCENARIO, "running invalid action checks");
    const invalidRecordId = "FLOW-INVALID-001";
    app.eventBus.emit({
      type: "APPROVAL_RECORD_CREATE",
      shipId,
      recordId: invalidRecordId,
      recordKind: "DEFECT",
      recordTitle: "Cooling line renewal",
      businessDate,
      occurredAt: "2026-03-20T13:00:00.000Z",
      actor: "MARINE_ENGINEERING_OFFICER",
    });
    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_SUBMIT",
        shipId,
        invalidRecordId,
        businessDate,
        "2026-03-20T14:00:00.000Z",
        "MARINE_ENGINEERING_OFFICER",
        "FLOW-INVALID-submit",
      ),
    );

    const beforeInvalid = app.store.getApprovalRecordViewInShip(invalidRecordId, shipId);
    const beforeInvalidOwner = beforeInvalid.record?.approval.currentOwner ?? null;
    const beforeInvalidStatus = beforeInvalid.record?.approval.status ?? null;
    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_APPROVE",
        shipId,
        invalidRecordId,
        businessDate,
        "2026-03-20T15:00:00.000Z",
        "FLEET_SUPPORT_GROUP",
        "FLOW-INVALID-wrong-role",
      ),
    );
    const afterWrongRole = app.store.getApprovalRecordViewInShip(invalidRecordId, shipId);
    assert.equal(afterWrongRole.record?.approval.currentOwner ?? null, beforeInvalidOwner);
    assert.equal(afterWrongRole.record?.approval.status ?? null, beforeInvalidStatus);

    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_APPROVE",
        shipId,
        invalidRecordId,
        businessDate,
        "2026-03-20T16:00:00.000Z",
        "COMMANDING_OFFICER",
        "FLOW-INVALID-shared-transition",
      ),
    );
    const afterValidApprove = app.store.getApprovalRecordViewInShip(invalidRecordId, shipId);
    assert.equal(afterValidApprove.record?.approval.currentOwner, "MARINE_ENGINEERING_OFFICER");
    assert.equal(afterValidApprove.record?.approval.status, "DRAFT");

    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_APPROVE",
        shipId,
        invalidRecordId,
        businessDate,
        "2026-03-20T16:30:00.000Z",
        "COMMANDING_OFFICER",
        "FLOW-INVALID-shared-transition",
      ),
    );
    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_REJECT",
        shipId,
        invalidRecordId,
        businessDate,
        "2026-03-20T17:00:00.000Z",
        "COMMANDING_OFFICER",
        "FLOW-INVALID-shared-transition",
        "Conflicting transition id",
      ),
    );

    const afterInvalid = app.store.getApprovalRecordViewInShip(invalidRecordId, shipId);
    assert.equal(afterInvalid.record?.approval.currentOwner, "MARINE_ENGINEERING_OFFICER");
    assert.equal(afterInvalid.record?.approval.status, "DRAFT");
    assert.equal(
      afterInvalid.history.filter((entry) => entry.actionType === "INVALID_ATTEMPT").length,
      3,
    );
    assert.equal(
      app.store.getProcessedApprovalTransition("FLOW-INVALID-shared-transition")?.actionType,
      "APPROVED",
    );
  });
}
