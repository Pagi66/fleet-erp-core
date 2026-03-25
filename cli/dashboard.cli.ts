import * as readline from "readline";
import {
  createApprovalRecordCreateEvent,
  createApprovalTransitionEvent,
} from "../src/events/approval-events";
import type {
  ActorContext,
  ApprovalAwarenessRecord,
  AssignedRoleId,
  FleetRecordKind,
} from "../src/core/types";
import { buildCommandDashboardView } from "../src/projections/command-dashboard.projection";
import {
  CommandDashboardPreviousState,
  getInitialDashboardState,
  restoreDashboardState,
  toCommandDashboardCardView,
} from "../src/projections/command-dashboard.interaction";
import { getOptimizedActionQueue } from "../src/projections/command-dashboard.decision";

process.env.LOG_LEVEL ??= "error";

// Load the app after setting the CLI log level.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createDailyLogEngineApp } = require("../src/index") as typeof import("../src/index");

interface DashboardSelection {
  index: number;
  section: "ACTION_REQUIRED" | "NEEDS_ATTENTION" | "FOR_AWARENESS";
  record: ApprovalAwarenessRecord;
}

const SHOULD_CLEAR_SCREEN = !process.argv.includes("--no-clear");

async function main(): Promise<void> {
  const app = createDailyLogEngineApp();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    seedDemoDataIfNeeded(app);
    const actor = await promptForActorContext(rl, app);
    let previousState: CommandDashboardPreviousState | null = null;

    while (true) {
      const dashboardState = buildDashboardState(app, actor, previousState);
      renderDashboard(dashboardState.selections, dashboardState.view);

      const input = (await question(
        rl,
        'Select a record number or type "r" to refresh or "q" to quit: ',
      )).trim().toLowerCase();

      if (input === "q") {
        break;
      }

      if (input === "r" || input === "") {
        previousState = {
          activeSection: dashboardState.navigation.activeSection,
          selectedRecordId: dashboardState.navigation.selectedRecordId,
          scrollPosition: dashboardState.navigation.scrollPosition,
          sectionRecordIds: {
            ACTION_REQUIRED: dashboardState.navigation.sections.ACTION_REQUIRED.recordIds,
            NEEDS_ATTENTION: dashboardState.navigation.sections.NEEDS_ATTENTION.recordIds,
            FOR_AWARENESS: dashboardState.navigation.sections.FOR_AWARENESS.recordIds,
          },
        };
        continue;
      }

      const selected = dashboardState.selections.find(
        (selection) => String(selection.index) === input,
      );
      if (!selected) {
        console.log("Invalid selection.\n");
        continue;
      }

      previousState = await openRecordDetail(rl, app, actor, selected, dashboardState.navigation);
    }
  } finally {
    rl.close();
    app.shutdown();
  }
}

function buildDashboardState(
  app: ReturnType<typeof createDailyLogEngineApp>,
  actor: ActorContext,
  previousState: CommandDashboardPreviousState | null,
): {
  view: ReturnType<typeof buildCommandDashboardView>;
  navigation: ReturnType<typeof getInitialDashboardState>;
  selections: DashboardSelection[];
} {
  const now = new Date().toISOString();
  const records = app.store.getApprovalAwarenessRecords(actor, { now });
  const summary = app.store.getApprovalDashboardSummary(actor, { now });
  const baseView = buildCommandDashboardView(actor.role, records, summary);
  const optimizedView = {
    ...baseView,
    sections: {
      ...baseView.sections,
      actionRequired: [...getOptimizedActionQueue(baseView)],
    },
  };

  const navigation = previousState
    ? restoreDashboardState(previousState, optimizedView)
    : getInitialDashboardState(optimizedView);

  return {
    view: optimizedView,
    navigation,
    selections: enumerateSelections(optimizedView),
  };
}

function renderDashboard(
  selections: readonly DashboardSelection[],
  view: ReturnType<typeof buildCommandDashboardView>,
): void {
  clearScreen();
  console.log("=== COMMAND DASHBOARD ===\n");
  console.log(
    `Pending: ${view.summary.pending} | Stale: ${view.summary.stale} | Rejected: ${view.summary.rejected} | Total: ${view.summary.total}\n`,
  );

  renderSection("ACTION REQUIRED", selections.filter((entry) => entry.section === "ACTION_REQUIRED"));
  renderSection("NEEDS ATTENTION", selections.filter((entry) => entry.section === "NEEDS_ATTENTION"));
  renderSection("FOR AWARENESS", selections.filter((entry) => entry.section === "FOR_AWARENESS"));
}

function renderSection(
  title: string,
  selections: readonly DashboardSelection[],
): void {
  console.log(`[${title}]`);
  if (selections.length === 0) {
    console.log("(empty)\n");
    return;
  }

  for (const selection of selections) {
    const card = toCommandDashboardCardView(selection.record);
    const ship = card.ship.name;
    const age = formatAge(card.ageHoursSinceLastAction);
    console.log(`${selection.index}. [${ship}] ${card.title} (${age})`);
  }
  console.log("");
}

async function openRecordDetail(
  rl: readline.Interface,
  app: ReturnType<typeof createDailyLogEngineApp>,
  actor: ActorContext,
  selection: DashboardSelection,
  navigation: ReturnType<typeof getInitialDashboardState>,
): Promise<CommandDashboardPreviousState> {
  while (true) {
    clearScreen();
    const card = toCommandDashboardCardView(selection.record);
    const detailView = app.store.getApprovalRecordViewForActor(selection.record.recordId, actor);
    const detailRecord = detailView.record;

    console.log("=== RECORD DETAIL ===\n");
    console.log(`Title: ${card.title}`);
    console.log(`Ship: ${card.ship.name}`);
    console.log(`Status: ${detailRecord?.approval.status ?? card.status}`);
    console.log(`Owner: ${detailRecord?.approval.currentOwner ?? card.currentOwner}`);
    console.log(`Age: ${formatAge(card.ageHoursSinceLastAction)}`);
    console.log("");
    console.log(`Reason: ${detailRecord?.approval.lastActionReason ?? card.reason ?? "N/A"}`);
    console.log(`Note: ${detailRecord?.approval.lastActionNote ?? card.note ?? "N/A"}`);
    console.log("");
    console.log("Actions:");
    console.log("1. Approve");
    console.log("2. Reject");
    console.log("3. Back");

    const input = (await question(rl, "Choose an action: ")).trim();

    if (input === "3" || input.toLowerCase() === "b") {
      return {
        activeSection: navigation.activeSection,
        selectedRecordId: selection.record.recordId,
        scrollPosition: navigation.scrollPosition,
        sectionRecordIds: {
          ACTION_REQUIRED: navigation.sections.ACTION_REQUIRED.recordIds,
          NEEDS_ATTENTION: navigation.sections.NEEDS_ATTENTION.recordIds,
          FOR_AWARENESS: navigation.sections.FOR_AWARENESS.recordIds,
        },
      };
    }

    if (input === "1") {
      if (!isActionableForRole(selection.record, actor.role)) {
        console.log("\nApprove is only available for ACTION REQUIRED records owned by your role.");
        await question(rl, "Press Enter to continue...");
        continue;
      }

      app.eventBus.emit(
        createApprovalTransitionEvent(
          "APPROVAL_RECORD_APPROVE",
          selection.record.shipId,
          selection.record.recordId,
          selection.record.businessDate,
          new Date().toISOString(),
          actor.role,
          buildTransitionId(selection.record.recordId, "approve"),
        ),
      );
      return {
        activeSection: navigation.activeSection,
        selectedRecordId: selection.record.recordId,
        scrollPosition: navigation.scrollPosition,
        sectionRecordIds: {
          ACTION_REQUIRED: navigation.sections.ACTION_REQUIRED.recordIds,
          NEEDS_ATTENTION: navigation.sections.NEEDS_ATTENTION.recordIds,
          FOR_AWARENESS: navigation.sections.FOR_AWARENESS.recordIds,
        },
      };
    }

    if (input === "2") {
      if (!isActionableForRole(selection.record, actor.role)) {
        console.log("\nReject is only available for ACTION REQUIRED records owned by your role.");
        await question(rl, "Press Enter to continue...");
        continue;
      }

      const reason = (await question(rl, "Enter rejection reason: ")).trim();
      if (reason === "") {
        console.log("\nA rejection reason is required.");
        await question(rl, "Press Enter to continue...");
        continue;
      }

      app.eventBus.emit(
        createApprovalTransitionEvent(
          "APPROVAL_RECORD_REJECT",
          selection.record.shipId,
          selection.record.recordId,
          selection.record.businessDate,
          new Date().toISOString(),
          actor.role,
          buildTransitionId(selection.record.recordId, "reject"),
          reason,
        ),
      );
      return {
        activeSection: navigation.activeSection,
        selectedRecordId: selection.record.recordId,
        scrollPosition: navigation.scrollPosition,
        sectionRecordIds: {
          ACTION_REQUIRED: navigation.sections.ACTION_REQUIRED.recordIds,
          NEEDS_ATTENTION: navigation.sections.NEEDS_ATTENTION.recordIds,
          FOR_AWARENESS: navigation.sections.FOR_AWARENESS.recordIds,
        },
      };
    }

    console.log("\nInvalid action.");
    await question(rl, "Press Enter to continue...");
  }
}

function enumerateSelections(
  view: ReturnType<typeof buildCommandDashboardView>,
): DashboardSelection[] {
  const selections: DashboardSelection[] = [];
  let index = 1;

  for (const record of view.sections.actionRequired) {
    selections.push({ index, section: "ACTION_REQUIRED", record });
    index += 1;
  }

  for (const record of view.sections.needsAttention) {
    selections.push({ index, section: "NEEDS_ATTENTION", record });
    index += 1;
  }

  for (const record of view.sections.forAwareness) {
    selections.push({ index, section: "FOR_AWARENESS", record });
    index += 1;
  }

  return selections;
}

function isActionableForRole(
  record: ApprovalAwarenessRecord,
  role: AssignedRoleId,
): boolean {
  return (
    record.bucket === "PENDING_MY_ACTION" &&
    record.status === "SUBMITTED" &&
    record.currentOwner === role
  );
}

function formatAge(ageHoursSinceLastAction: number | null): string {
  return ageHoursSinceLastAction === null ? "N/A" : `${ageHoursSinceLastAction}h`;
}

function buildTransitionId(recordId: string, action: "approve" | "reject"): string {
  return `cli:${action}:${recordId}:${Date.now()}`;
}

async function promptForActorContext(
  rl: readline.Interface,
  app: ReturnType<typeof createDailyLogEngineApp>,
): Promise<ActorContext> {
  console.log("Select role:");
  console.log("1. MEO");
  console.log("2. CO");
  console.log("3. WEO");
  console.log("4. FSG");
  console.log("5. LOG_COMD");

  while (true) {
    const input = (await question(rl, "Role [1-5]: ")).trim();
    let role: AssignedRoleId | null = null;
    switch (input) {
      case "1":
        role = "MARINE_ENGINEERING_OFFICER";
        break;
      case "2":
        role = "COMMANDING_OFFICER";
        break;
      case "3":
        role = "WEAPON_ELECTRICAL_OFFICER";
        break;
      case "4":
        role = "FLEET_SUPPORT_GROUP";
        break;
      case "5":
        role = "LOGISTICS_COMMAND";
        break;
      default:
        console.log("Invalid role selection.");
        continue;
    }

    if (
      role === "MARINE_ENGINEERING_OFFICER" ||
      role === "WEAPON_ELECTRICAL_OFFICER" ||
      role === "COMMANDING_OFFICER"
    ) {
      const shipId = await promptForShipId(rl, app);
      return {
        role,
        shipId,
      };
    }

    return { role };
  }
}

async function promptForShipId(
  rl: readline.Interface,
  app: ReturnType<typeof createDailyLogEngineApp>,
): Promise<string> {
  const ships = app.store.getAllShips();
  console.log("Select ship:");
  for (const ship of ships) {
    console.log(`- ${ship.id}: ${ship.name}`);
  }

  while (true) {
    const input = (await question(rl, "Ship ID: ")).trim();
    if (ships.some((ship) => ship.id === input)) {
      return input;
    }
    console.log("Invalid ship ID.");
  }
}

async function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function seedDemoDataIfNeeded(
  app: ReturnType<typeof createDailyLogEngineApp>,
): void {
  if (app.store.getAllShips().length > 0) {
    return;
  }

  app.store.saveShip({ id: "SHIP-A", name: "Ship A", classType: "Frigate" });
  app.store.saveShip({ id: "SHIP-B", name: "Ship B", classType: "Corvette" });

  seedRecord(app, {
    shipId: "SHIP-A",
    recordId: "CLI-001",
    title: "Engine defect",
    kind: "DEFECT",
    originRole: "MARINE_ENGINEERING_OFFICER",
    createdAt: "2026-03-20T08:00:00.000Z",
    progression: "CO_PENDING",
  });
  seedRecord(app, {
    shipId: "SHIP-B",
    recordId: "CLI-002",
    title: "Fuel issue",
    kind: "WORK_REQUEST",
    originRole: "MARINE_ENGINEERING_OFFICER",
    createdAt: "2026-03-21T08:00:00.000Z",
    progression: "CO_PENDING",
  });
  seedRecord(app, {
    shipId: "SHIP-A",
    recordId: "CLI-003",
    title: "Cooling pump rejection",
    kind: "WORK_REQUEST",
    originRole: "MARINE_ENGINEERING_OFFICER",
    createdAt: "2026-03-23T08:00:00.000Z",
    progression: "REJECTED_AT_CO",
    rejectionReason: "Awaiting approval",
  });
  seedRecord(app, {
    shipId: "SHIP-B",
    recordId: "CLI-004",
    title: "Routine maintenance log",
    kind: "MAINTENANCE_LOG",
    originRole: "MARINE_ENGINEERING_OFFICER",
    createdAt: "2026-03-22T08:00:00.000Z",
    progression: "APPROVED",
  });
}

function clearScreen(): void {
  if (SHOULD_CLEAR_SCREEN) {
    console.clear();
  }
}

function seedRecord(
  app: ReturnType<typeof createDailyLogEngineApp>,
  input: {
    shipId: string;
    recordId: string;
    title: string;
    kind: FleetRecordKind;
    originRole: AssignedRoleId;
    createdAt: string;
    progression: "CO_PENDING" | "APPROVED" | "REJECTED_AT_CO";
    rejectionReason?: string;
  },
): void {
  const businessDate = "2026-03-20";
  app.eventBus.emit(
    createApprovalRecordCreateEvent(
      input.shipId,
      input.recordId,
      input.kind,
      input.title,
      businessDate,
      input.createdAt,
      input.originRole,
    ),
  );
  const submitAt = new Date(new Date(input.createdAt).getTime() + 30 * 60 * 1000).toISOString();
  app.eventBus.emit(
    createApprovalTransitionEvent(
      "APPROVAL_RECORD_SUBMIT",
      input.shipId,
      input.recordId,
      businessDate,
      submitAt,
      input.originRole,
      `${input.recordId}-submit`,
    ),
  );

  if (input.progression === "CO_PENDING") {
    return;
  }

  const decisionAt = new Date(new Date(submitAt).getTime() + 30 * 60 * 1000).toISOString();

  if (input.progression === "REJECTED_AT_CO") {
    app.eventBus.emit(
      createApprovalTransitionEvent(
        "APPROVAL_RECORD_REJECT",
        input.shipId,
        input.recordId,
        businessDate,
        decisionAt,
        "COMMANDING_OFFICER",
        `${input.recordId}-reject`,
        input.rejectionReason ?? "Awaiting approval",
        "Vibration issue",
      ),
    );
    return;
  }

  app.eventBus.emit(
    createApprovalTransitionEvent(
      "APPROVAL_RECORD_APPROVE",
      input.shipId,
      input.recordId,
      businessDate,
      decisionAt,
      "COMMANDING_OFFICER",
      `${input.recordId}-approve-co`,
    ),
  );
  const fsgAt = new Date(new Date(decisionAt).getTime() + 30 * 60 * 1000).toISOString();
  app.eventBus.emit(
    createApprovalTransitionEvent(
      "APPROVAL_RECORD_APPROVE",
      input.shipId,
      input.recordId,
      businessDate,
      fsgAt,
      "FLEET_SUPPORT_GROUP",
      `${input.recordId}-approve-fsg`,
    ),
  );
  const logAt = new Date(new Date(fsgAt).getTime() + 30 * 60 * 1000).toISOString();
  app.eventBus.emit(
    createApprovalTransitionEvent(
      "APPROVAL_RECORD_APPROVE",
      input.shipId,
      input.recordId,
      businessDate,
      logAt,
      "LOGISTICS_COMMAND",
      `${input.recordId}-approve-log`,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
