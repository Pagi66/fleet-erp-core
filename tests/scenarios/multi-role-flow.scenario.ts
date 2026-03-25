import { strict as assert } from "assert";
import { buildCommandDashboardView } from "../../src/projections/command-dashboard.projection";
import { withScenarioApp, seedRecord, logScenario } from "./helpers";

const SCENARIO = "multi-role-flow";

export async function runScenario(): Promise<void> {
  await withScenarioApp(SCENARIO, (app) => {
    const businessDate = "2026-03-20";

    logScenario(SCENARIO, "seeding role-spanning records");
    seedRecord(app, {
      shipId: "NNS-ALPHA",
      recordId: "MR-001",
      title: "MEO pending CO",
      kind: "WORK_REQUEST",
      originRole: "MARINE_ENGINEERING_OFFICER",
      progression: "CO_PENDING",
      businessDate,
      createdAt: "2026-03-20T08:00:00.000Z",
    });
    seedRecord(app, {
      shipId: "NNS-BRAVO",
      recordId: "MR-002",
      title: "WEO pending FSG",
      kind: "DEFECT",
      originRole: "WEAPON_ELECTRICAL_OFFICER",
      progression: "FSG_PENDING",
      businessDate,
      createdAt: "2026-03-20T09:00:00.000Z",
    });
    seedRecord(app, {
      shipId: "NNS-CHARLIE",
      recordId: "MR-003",
      title: "MEO pending LOG",
      kind: "DEFECT",
      originRole: "MARINE_ENGINEERING_OFFICER",
      progression: "LOG_PENDING",
      businessDate,
      createdAt: "2026-03-20T10:00:00.000Z",
    });
    seedRecord(app, {
      shipId: "NNS-ALPHA",
      recordId: "MR-004",
      title: "MEO rejected at FSG",
      kind: "WORK_REQUEST",
      originRole: "MARINE_ENGINEERING_OFFICER",
      progression: "REJECTED_AT_FSG",
      businessDate,
      createdAt: "2026-03-23T08:00:00.000Z",
      rejectionReason: "Insufficient technical detail",
    });

    const now = "2026-03-24T12:00:00.000Z";

    const coSummary = app.store.getApprovalDashboardSummary({ role: "COMMANDING_OFFICER", shipId: "NNS-ALPHA" }, { now });
    const fsgSummary = app.store.getApprovalDashboardSummary({ role: "FLEET_SUPPORT_GROUP" }, { now });
    const logSummary = app.store.getApprovalDashboardSummary({ role: "LOGISTICS_COMMAND" }, { now });
    const meoSummary = app.store.getApprovalDashboardSummary({ role: "MARINE_ENGINEERING_OFFICER", shipId: "NNS-ALPHA" }, { now });

    assert.ok(coSummary.records.some((record) => record.recordId === "MR-001" && record.bucket === "PENDING_MY_ACTION"));
    assert.ok(fsgSummary.records.some((record) => record.recordId === "MR-002" && record.bucket === "PENDING_MY_ACTION"));
    assert.ok(logSummary.records.some((record) => record.recordId === "MR-003" && record.bucket === "PENDING_MY_ACTION"));
    assert.ok(meoSummary.records.some((record) => record.recordId === "MR-004" && record.bucket === "RECENTLY_REJECTED"));

    const coView = buildCommandDashboardView("COMMANDING_OFFICER", coSummary.records, coSummary);
    const fsgView = buildCommandDashboardView("FLEET_SUPPORT_GROUP", fsgSummary.records, fsgSummary);
    const logView = buildCommandDashboardView("LOGISTICS_COMMAND", logSummary.records, logSummary);

    assert.ok(coView.sections.actionRequired.some((record) => record.recordId === "MR-001"));
    assert.ok(fsgView.sections.actionRequired.some((record) => record.recordId === "MR-002"));
    assert.ok(logView.sections.actionRequired.some((record) => record.recordId === "MR-003"));
    assert.ok(coSummary.records.every((record) => record.visibleTo.includes("COMMANDING_OFFICER")));
    assert.ok(meoSummary.records.every((record) => record.visibleTo.includes("MARINE_ENGINEERING_OFFICER")));
    assert.ok(coSummary.records.every((record) => record.shipId === "NNS-ALPHA"));
    assert.ok(meoSummary.records.every((record) => record.shipId === "NNS-ALPHA"));
    assert.ok(fsgSummary.records.some((record) => record.shipId === "NNS-ALPHA"));
    assert.ok(fsgSummary.records.some((record) => record.shipId === "NNS-BRAVO"));
    assert.ok(logSummary.records.some((record) => record.shipId === "NNS-CHARLIE"));
  });
}
