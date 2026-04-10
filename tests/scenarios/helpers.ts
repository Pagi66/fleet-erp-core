import { strict as assert } from "assert";
import { existsSync, mkdirSync, rmSync } from "fs";
import { dirname, resolve } from "path";
import { createDailyLogEngineApp } from "../../src/index";
import {
  createApprovalRecordCreateEvent,
  createApprovalTransitionEvent,
} from "../../src/events/approval-events";
import {
  ActorContext,
  ApprovalAwarenessRecord,
  AssignedRoleId,
  FleetRecordKind,
  RoleDashboardSummary,
  Ship,
} from "../../src/core/types";
import { buildCommandDashboardView, CommandDashboardView } from "../../src/projections/command-dashboard.projection";

export type ScenarioApp = ReturnType<typeof createDailyLogEngineApp>;

export interface ScenarioDataset {
  now: string;
  records: ApprovalAwarenessRecord[];
  summary: RoleDashboardSummary;
  view: CommandDashboardView;
}

export interface SeedRecordOptions {
  shipId: string;
  recordId: string;
  title: string;
  kind: FleetRecordKind;
  originRole: AssignedRoleId;
  businessDate: string;
  createdAt: string;
  progression:
    | "DRAFT"
    | "CO_PENDING"
    | "FSG_PENDING"
    | "LOG_PENDING"
    | "APPROVED"
    | "REJECTED_AT_CO"
    | "REJECTED_AT_FSG"
    | "REJECTED_AT_LOG";
  rejectionReason?: string;
  description?: string;
}

export const SCENARIO_SHIPS: Ship[] = [
  { id: "NNS-ALPHA", name: "NNS Alpha", classType: "Frigate", jurisdictions: ["FLEET_SUPPORT_GROUP"] },
  { id: "NNS-BRAVO", name: "NNS Bravo", classType: "Corvette", jurisdictions: ["FLEET_SUPPORT_GROUP"] },
  { id: "NNS-CHARLIE", name: "NNS Charlie", classType: "Patrol", jurisdictions: ["FLEET_SUPPORT_GROUP"] },
];

export async function withScenarioApp(
  scenarioName: string,
  run: (app: ScenarioApp) => Promise<void> | void,
): Promise<void> {
  cleanupScenarioPersistence();
  const app = createDailyLogEngineApp();

  try {
    seedShips(app);
    logScenario(scenarioName, "app started");
    await run(app);
  } finally {
    app.shutdown();
    cleanupScenarioPersistence();
  }
}

export function seedShips(app: ScenarioApp): void {
  for (const ship of SCENARIO_SHIPS) {
    app.store.saveShip(ship);
  }
}

export function emitCreateRecord(app: ScenarioApp, options: SeedRecordOptions): void {
  app.eventBus.emit(
    createApprovalRecordCreateEvent(
      options.shipId,
      options.recordId,
      options.kind,
      options.title,
      options.businessDate,
      options.createdAt,
      options.originRole,
      options.description,
    ),
  );
}

export function emitSubmitRecord(
  app: ScenarioApp,
  shipId: string,
  recordId: string,
  businessDate: string,
  occurredAt: string,
  actor: AssignedRoleId,
  transitionId: string,
  reason?: string,
): void {
  app.eventBus.emit(
    createApprovalTransitionEvent(
      "APPROVAL_RECORD_SUBMIT",
      shipId,
      recordId,
      businessDate,
      occurredAt,
      actor,
      transitionId,
      reason,
    ),
  );
}

export function emitApproveRecord(
  app: ScenarioApp,
  shipId: string,
  recordId: string,
  businessDate: string,
  occurredAt: string,
  actor: AssignedRoleId,
  transitionId: string,
  reason?: string,
): void {
  app.eventBus.emit(
    createApprovalTransitionEvent(
      "APPROVAL_RECORD_APPROVE",
      shipId,
      recordId,
      businessDate,
      occurredAt,
      actor,
      transitionId,
      reason,
    ),
  );
}

export function emitRejectRecord(
  app: ScenarioApp,
  shipId: string,
  recordId: string,
  businessDate: string,
  occurredAt: string,
  actor: AssignedRoleId,
  transitionId: string,
  reason: string,
): void {
  app.eventBus.emit(
    createApprovalTransitionEvent(
      "APPROVAL_RECORD_REJECT",
      shipId,
      recordId,
      businessDate,
      occurredAt,
      actor,
      transitionId,
      reason,
    ),
  );
}

export function seedRecord(app: ScenarioApp, options: SeedRecordOptions): void {
  emitCreateRecord(app, options);

  const timeline = createTimeline(options.createdAt, 30);
  const submitAt = timeline();
  const approveAtCo = timeline();
  const approveAtFsg = timeline();
  const approveAtLog = timeline();

  switch (options.progression) {
    case "DRAFT":
      return;
    case "CO_PENDING":
      emitSubmitRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        submitAt,
        options.originRole,
        `${options.recordId}-submit`,
      );
      return;
    case "FSG_PENDING":
      emitSubmitRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        submitAt,
        options.originRole,
        `${options.recordId}-submit`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtCo,
        "COMMANDING_OFFICER",
        `${options.recordId}-approve-co`,
      );
      return;
    case "LOG_PENDING":
      emitSubmitRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        submitAt,
        options.originRole,
        `${options.recordId}-submit`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtCo,
        "COMMANDING_OFFICER",
        `${options.recordId}-approve-co`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtFsg,
        "FLEET_SUPPORT_GROUP",
        `${options.recordId}-approve-fsg`,
      );
      return;
    case "APPROVED":
      emitSubmitRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        submitAt,
        options.originRole,
        `${options.recordId}-submit`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtCo,
        "COMMANDING_OFFICER",
        `${options.recordId}-approve-co`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtFsg,
        "FLEET_SUPPORT_GROUP",
        `${options.recordId}-approve-fsg`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtLog,
        "LOGISTICS_COMMAND",
        `${options.recordId}-approve-log`,
      );
      return;
    case "REJECTED_AT_CO":
      emitSubmitRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        submitAt,
        options.originRole,
        `${options.recordId}-submit`,
      );
      emitRejectRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtCo,
        "COMMANDING_OFFICER",
        `${options.recordId}-reject-co`,
        options.rejectionReason ?? "Missing engineering evidence",
      );
      return;
    case "REJECTED_AT_FSG":
      emitSubmitRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        submitAt,
        options.originRole,
        `${options.recordId}-submit`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtCo,
        "COMMANDING_OFFICER",
        `${options.recordId}-approve-co`,
      );
      emitRejectRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtFsg,
        "FLEET_SUPPORT_GROUP",
        `${options.recordId}-reject-fsg`,
        options.rejectionReason ?? "Insufficient technical detail",
      );
      return;
    case "REJECTED_AT_LOG":
      emitSubmitRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        submitAt,
        options.originRole,
        `${options.recordId}-submit`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtCo,
        "COMMANDING_OFFICER",
        `${options.recordId}-approve-co`,
      );
      emitApproveRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtFsg,
        "FLEET_SUPPORT_GROUP",
        `${options.recordId}-approve-fsg`,
      );
      emitRejectRecord(
        app,
        options.shipId,
        options.recordId,
        options.businessDate,
        approveAtLog,
        "LOGISTICS_COMMAND",
        `${options.recordId}-reject-log`,
        options.rejectionReason ?? "Funding documentation incomplete",
      );
      return;
    default: {
      const exhaustiveCheck: never = options.progression;
      throw new Error(`Unsupported scenario progression: ${exhaustiveCheck}`);
    }
  }
}

export function buildMixedDataset(
  app: ScenarioApp,
  actor: ActorContext,
): ScenarioDataset {
  const businessDate = "2026-03-20";
  const now = "2026-03-24T12:00:00.000Z";
  const specs: SeedRecordOptions[] = [
    makeSeed("NNS-ALPHA", "REC-001", "MEO draft 1", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "DRAFT", "2026-03-20T08:00:00.000Z"),
    makeSeed("NNS-ALPHA", "REC-002", "MEO pending CO 1", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "CO_PENDING", "2026-03-20T09:00:00.000Z"),
    makeSeed("NNS-ALPHA", "REC-003", "MEO pending FSG 1", "DEFECT", "MARINE_ENGINEERING_OFFICER", "FSG_PENDING", "2026-03-20T10:00:00.000Z"),
    makeSeed("NNS-ALPHA", "REC-004", "MEO pending LOG 1", "DEFECT", "MARINE_ENGINEERING_OFFICER", "LOG_PENDING", "2026-03-20T11:00:00.000Z"),
    makeSeed("NNS-ALPHA", "REC-005", "MEO approved 1", "MAINTENANCE_LOG", "MARINE_ENGINEERING_OFFICER", "APPROVED", "2026-03-20T12:00:00.000Z"),
    makeSeed("NNS-ALPHA", "REC-006", "MEO rejected CO 1", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "REJECTED_AT_CO", "2026-03-23T08:00:00.000Z", "Missing engineering evidence"),
    makeSeed("NNS-BRAVO", "REC-007", "MEO draft 2", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "DRAFT", "2026-03-20T13:00:00.000Z"),
    makeSeed("NNS-BRAVO", "REC-008", "MEO pending CO 2", "DEFECT", "MARINE_ENGINEERING_OFFICER", "CO_PENDING", "2026-03-20T14:00:00.000Z"),
    makeSeed("NNS-BRAVO", "REC-009", "MEO pending FSG 2", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "FSG_PENDING", "2026-03-20T15:00:00.000Z"),
    makeSeed("NNS-BRAVO", "REC-010", "MEO pending LOG 2", "DEFECT", "MARINE_ENGINEERING_OFFICER", "LOG_PENDING", "2026-03-20T16:00:00.000Z"),
    makeSeed("NNS-BRAVO", "REC-011", "MEO approved 2", "MAINTENANCE_LOG", "MARINE_ENGINEERING_OFFICER", "APPROVED", "2026-03-20T17:00:00.000Z"),
    makeSeed("NNS-BRAVO", "REC-012", "MEO rejected FSG 1", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "REJECTED_AT_FSG", "2026-03-23T09:00:00.000Z", "Insufficient technical detail"),
    makeSeed("NNS-CHARLIE", "REC-013", "WEO draft 1", "WORK_REQUEST", "WEAPON_ELECTRICAL_OFFICER", "DRAFT", "2026-03-20T18:00:00.000Z"),
    makeSeed("NNS-CHARLIE", "REC-014", "WEO pending CO 1", "DEFECT", "WEAPON_ELECTRICAL_OFFICER", "CO_PENDING", "2026-03-20T19:00:00.000Z"),
    makeSeed("NNS-CHARLIE", "REC-015", "WEO pending FSG 1", "WORK_REQUEST", "WEAPON_ELECTRICAL_OFFICER", "FSG_PENDING", "2026-03-20T20:00:00.000Z"),
    makeSeed("NNS-CHARLIE", "REC-016", "WEO pending LOG 1", "DEFECT", "WEAPON_ELECTRICAL_OFFICER", "LOG_PENDING", "2026-03-20T21:00:00.000Z"),
    makeSeed("NNS-CHARLIE", "REC-017", "WEO approved 1", "MAINTENANCE_LOG", "WEAPON_ELECTRICAL_OFFICER", "APPROVED", "2026-03-20T22:00:00.000Z"),
    makeSeed("NNS-CHARLIE", "REC-018", "WEO rejected CO 1", "WORK_REQUEST", "WEAPON_ELECTRICAL_OFFICER", "REJECTED_AT_CO", "2026-03-23T10:00:00.000Z", "Missing engineering evidence"),
    makeSeed("NNS-ALPHA", "REC-019", "MEO pending CO 3", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "CO_PENDING", "2026-03-21T08:00:00.000Z"),
    makeSeed("NNS-BRAVO", "REC-020", "MEO rejected CO 2", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "REJECTED_AT_CO", "2026-03-23T11:00:00.000Z", "Missing engineering evidence"),
    makeSeed("NNS-CHARLIE", "REC-021", "WEO rejected FSG 1", "DEFECT", "WEAPON_ELECTRICAL_OFFICER", "REJECTED_AT_FSG", "2026-03-23T12:00:00.000Z", "Insufficient technical detail"),
    makeSeed("NNS-ALPHA", "REC-022", "MEO approved 3", "MAINTENANCE_LOG", "MARINE_ENGINEERING_OFFICER", "APPROVED", "2026-03-21T09:00:00.000Z"),
    makeSeed("NNS-BRAVO", "REC-023", "WEO pending LOG 2", "DEFECT", "WEAPON_ELECTRICAL_OFFICER", "LOG_PENDING", "2026-03-21T10:00:00.000Z"),
    makeSeed("NNS-CHARLIE", "REC-024", "MEO pending FSG 3", "WORK_REQUEST", "MARINE_ENGINEERING_OFFICER", "FSG_PENDING", "2026-03-21T11:00:00.000Z"),
  ];

  for (const spec of specs) {
    seedRecord(app, {
      ...spec,
      businessDate,
    });
  }

  const summary = app.store.getApprovalDashboardSummary(actor, { now });
  const records = app.store.getApprovalAwarenessRecords(actor, { now });
  const view = buildCommandDashboardView(actor.role, records, summary);

  return {
    now,
    summary,
    records,
    view,
  };
}

export function buildStressDataset(
  app: ScenarioApp,
  actor: ActorContext,
  count: number,
): ScenarioDataset {
  const businessDate = "2026-03-20";
  const now = "2026-03-24T12:00:00.000Z";
  const ships = SCENARIO_SHIPS.map((ship) => ship.id);
  const kinds: FleetRecordKind[] = ["WORK_REQUEST", "DEFECT", "MAINTENANCE_LOG"];
  const origins: AssignedRoleId[] = ["MARINE_ENGINEERING_OFFICER", "WEAPON_ELECTRICAL_OFFICER"];
  const progressions: SeedRecordOptions["progression"][] = [
    "DRAFT",
    "CO_PENDING",
    "FSG_PENDING",
    "LOG_PENDING",
    "APPROVED",
    "REJECTED_AT_CO",
    "REJECTED_AT_FSG",
  ];

  for (let index = 0; index < count; index += 1) {
    seedRecord(app, {
      shipId: ships[index % ships.length]!,
      recordId: `STRESS-${String(index + 1).padStart(3, "0")}`,
      title: `Stress record ${index + 1}`,
      kind: kinds[index % kinds.length]!,
      originRole: origins[index % origins.length]!,
      progression: progressions[index % progressions.length]!,
      businessDate,
      createdAt: new Date(Date.UTC(2026, 2, 20, 8 + (index % 10), index % 60, 0)).toISOString(),
      rejectionReason: index % 2 === 0 ? "Missing engineering evidence" : "Insufficient technical detail",
    });
  }

  const summary = app.store.getApprovalDashboardSummary(actor, { now });
  const records = app.store.getApprovalAwarenessRecords(actor, { now });
  const view = buildCommandDashboardView(actor.role, records, summary);

  return {
    now,
    summary,
    records,
    view,
  };
}

export function createTimeline(startIso: string, stepMinutes: number): () => string {
  let current = new Date(startIso).getTime();
  return () => {
    current += stepMinutes * 60 * 1000;
    return new Date(current).toISOString();
  };
}

export function logScenario(name: string, message: string): void {
  console.log(`[${name}] ${message}`);
}

export function assertNoDuplicateRecordIds(recordIds: readonly string[]): void {
  assert.equal(new Set(recordIds).size, recordIds.length);
}

function cleanupScenarioPersistence(): void {
  const persistencePath = resolve(
    process.cwd(),
    process.env.PERSISTENCE_FILE_PATH ?? "tests/scenarios/.tmp/store-state.json",
  );
  mkdirSync(dirname(persistencePath), { recursive: true });

  for (const path of [persistencePath, `${persistencePath}.bak`, `${persistencePath}.tmp`]) {
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
}

function makeSeed(
  shipId: string,
  recordId: string,
  title: string,
  kind: FleetRecordKind,
  originRole: AssignedRoleId,
  progression: SeedRecordOptions["progression"],
  createdAt: string,
  rejectionReason?: string,
): SeedRecordOptions {
  return {
    shipId,
    recordId,
    title,
    kind,
    originRole,
    progression,
    createdAt,
    businessDate: "2026-03-20",
    ...(rejectionReason ? { rejectionReason } : {}),
  };
}
