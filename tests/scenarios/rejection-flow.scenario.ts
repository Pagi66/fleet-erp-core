import { strict as assert } from "assert";
import { createApprovalTransitionEvent } from "../../src/events/approval-events";
import { withScenarioApp, logScenario } from "./helpers";

const SCENARIO = "rejection-flow";

export async function runScenario(): Promise<void> {
  await withScenarioApp(SCENARIO, (app) => {
    const shipId = "NNS-BRAVO";
    const recordId = "REJECT-001";
    const businessDate = "2026-03-20";

    logScenario(SCENARIO, "creating and rejecting approval record");
    app.eventBus.emit({
      type: "APPROVAL_RECORD_CREATE",
      shipId,
      recordId,
      recordKind: "WORK_REQUEST",
      recordTitle: "Cylinder head replacement",
      businessDate,
      occurredAt: "2026-03-22T08:00:00.000Z",
      actor: "MARINE_ENGINEERING_OFFICER",
    });
    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_SUBMIT",
        shipId,
        recordId,
        businessDate,
        "2026-03-22T09:00:00.000Z",
        "MARINE_ENGINEERING_OFFICER",
        "REJECT-001-submit",
      ),
    );
    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_REJECT",
        shipId,
        recordId,
        businessDate,
        "2026-03-22T10:00:00.000Z",
        "COMMANDING_OFFICER",
        "REJECT-001-reject",
        "Missing cost estimate",
        "Attach estimate before resubmission",
      ),
    );

    const recordView = app.store.getApprovalRecordViewInShip(recordId, shipId);
    const lastHistoryEntry = recordView.history[recordView.history.length - 1];
    assert.equal(recordView.record?.approval.status, "REJECTED");
    assert.equal(recordView.record?.approval.currentOwner, "MARINE_ENGINEERING_OFFICER");
    assert.equal(recordView.record?.approval.lastActionReason, "Missing cost estimate");
    assert.equal(recordView.record?.approval.lastActionNote, "Attach estimate before resubmission");
    assert.equal(lastHistoryEntry?.actionType, "REJECTED");
    assert.equal(lastHistoryEntry?.previousState.currentOwner, "COMMANDING_OFFICER");
    assert.equal(lastHistoryEntry?.newState.currentOwner, "MARINE_ENGINEERING_OFFICER");

    const meoSummary = app.store.getApprovalDashboardSummary({
      role: "MARINE_ENGINEERING_OFFICER",
      shipId,
    }, {
      now: "2026-03-24T10:00:00.000Z",
    });
    const rejectedRecord = meoSummary.records.find((record) => record.recordId === recordId);
    assert.ok(rejectedRecord);
    assert.equal(rejectedRecord?.bucket, "RECENTLY_REJECTED");
    assert.equal(rejectedRecord?.previousOwner, "COMMANDING_OFFICER");
    assert.ok(rejectedRecord?.attentionSignals.includes("BLOCKED_BY_REJECTION"));
  });
}
