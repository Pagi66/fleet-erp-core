import type { ActorContext, FleetRecord, Task } from "../src/core/types";
import {
  clearScreen,
  CliApp,
  type CliPromptLike,
  formatCount,
  getShipDisplayName,
  getTodayBusinessDate,
  question,
} from "./shared";

export interface ShipWorkspaceMenuItem {
  label: string;
  buildDetail: (input: WorkspaceBuildInput) => string[];
}

export interface ShipWorkspaceConfig {
  title: string;
  subtitle: string;
  menuItems: readonly ShipWorkspaceMenuItem[];
}

interface WorkspaceBuildInput {
  app: CliApp;
  actor: ActorContext & { shipId: string };
  businessDate: string;
  records: FleetRecord[];
  tasks: Task[];
}

export async function runShipWorkspaceCli(
  rl: CliPromptLike,
  app: CliApp,
  actor: ActorContext,
  config: ShipWorkspaceConfig,
): Promise<void> {
  if (!actor.shipId) {
    throw new Error(`${config.title} requires a ship-scoped actor context`);
  }
  const shipActor: ActorContext & { shipId: string } = {
    role: actor.role,
    shipId: actor.shipId,
  };

  while (true) {
    const businessDate = getTodayBusinessDate();
    const records = app.store
      .getApprovalRecordsByShip(shipActor.shipId)
      .filter((record) => record.visibleTo.includes(shipActor.role));
    const tasks = app.store
      .getTasksByShip(shipActor.shipId)
      .filter((task) => task.assignedRole === shipActor.role);

    renderWorkspaceHome(app, shipActor, config, businessDate, records, tasks);
    const input = (
      await question(
        rl,
        'Choose a workspace item, type "r" to refresh, or "q" to quit: ',
      )
    )
      .trim()
      .toLowerCase();

    if (input === "q") {
      return;
    }

    if (input === "r" || input === "") {
      continue;
    }

    const selectedIndex = Number(input);
    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 1 ||
      selectedIndex > config.menuItems.length
    ) {
      console.log("Invalid workspace selection.\n");
      continue;
    }

    const menuItem = config.menuItems[selectedIndex - 1];
    if (!menuItem) {
      console.log("Invalid workspace selection.\n");
      continue;
    }
    await openWorkspaceItem(
      rl,
      app,
      shipActor,
      config.title,
      menuItem,
      businessDate,
      records,
      tasks,
    );
  }
}

function renderWorkspaceHome(
  app: CliApp,
  actor: ActorContext & { shipId: string },
  config: ShipWorkspaceConfig,
  businessDate: string,
  records: FleetRecord[],
  tasks: Task[],
): void {
  clearScreen();
  const snapshot = app.store.getSnapshot(actor.shipId, businessDate);
  const pendingApprovals = records.filter(
    (record) =>
      record.approval.currentOwner === actor.role &&
      record.approval.status === "SUBMITTED",
  ).length;

  console.log(`=== ${config.title} ===\n`);
  console.log(`${config.subtitle}\n`);
  console.log(`Ship: ${getShipDisplayName(app, actor.shipId)}`);
  console.log(
    `${formatCount("Logs", snapshot.logs.length)} | ${formatCount("Missing", snapshot.complianceState.missingLogs.length)} | ${formatCount("Assigned Tasks", tasks.length)} | ${formatCount("Pending Approvals", pendingApprovals)}`,
  );
  console.log("");

  config.menuItems.forEach((item, index) => {
    console.log(`${index + 1}. ${item.label}`);
  });
  console.log("");
}

async function openWorkspaceItem(
  rl: CliPromptLike,
  app: CliApp,
  actor: ActorContext & { shipId: string },
  title: string,
  menuItem: ShipWorkspaceMenuItem,
  businessDate: string,
  records: FleetRecord[],
  tasks: Task[],
): Promise<void> {
  clearScreen();
  console.log(`=== ${title} ===\n`);
  console.log(`${menuItem.label}\n`);
  for (const line of menuItem.buildDetail({
    app,
    actor,
    businessDate,
    records,
    tasks,
  })) {
    console.log(line);
  }
  console.log("");
  await question(rl, "Press Enter to return...");
}
