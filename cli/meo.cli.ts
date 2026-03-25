import type {
  ActorContext,
  ApprovalAwarenessRecord,
  FleetRecord,
  LogRecord,
  Task,
} from "../src/core/types";
import { createApprovalRecordCreateEvent } from "../src/events/approval-events";
import {
  countOverdueOperationalItems,
  getComplianceStatus,
  getMonthlyReturnStatus,
  getTodayEngineRoomRegisterStatus,
  getWeeklyReturnStatus,
  type ComplianceStatus,
} from "./compliance";
import {
  clearScreen,
  CliApp,
  type CliPromptLike,
  getShipDisplayName,
  question,
} from "./shared";

type MeoSection = "TODAY" | "MAINTENANCE" | "RETURNS" | "STORES";

interface MeoWorkspaceItem {
  id: string;
  number: number;
  section: MeoSection;
  title: string;
  summary: string;
  status: ComplianceStatus;
  buildDetail: () => string[];
}

interface MeoWorkspaceState {
  title: string;
  focus: MeoSection;
  alerts: string[];
  flashMessage: string | null;
  items: MeoWorkspaceItem[];
  dailyStatus: "COMPLETE" | "INCOMPLETE";
  dailyCompleted: number;
  dailyPending: number;
  criticalAcksRequired: string[];
}

export async function runMeoCli(
  rl: CliPromptLike,
  app: CliApp,
  actor: ActorContext,
): Promise<void> {
  if (!actor.shipId) {
    throw new Error("MEO CLI requires a ship-scoped actor context");
  }

  const shipActor = { role: actor.role, shipId: actor.shipId };
  let lastSection: MeoSection = "TODAY";
  let flashMessage: string | null = null;
  const acknowledgedCriticalItems = new Set<string>();

  while (true) {
    const now = new Date().toISOString();
    const businessDate = now.slice(0, 10);
    const snapshot = app.store.getSnapshot(shipActor.shipId, businessDate);
    const records = app.store
      .getApprovalRecordsByShip(shipActor.shipId)
      .filter((record) => record.visibleTo.includes(shipActor.role));
    const tasks = app.store
      .getTasksByShip(shipActor.shipId)
      .filter((task) => task.assignedRole === shipActor.role);
    const awarenessRecords = app.store.getApprovalAwarenessRecords(shipActor, { now });
    const workspace = buildMeoWorkspace({
      app,
      shipId: shipActor.shipId,
      now,
      records,
      tasks,
      awarenessRecords,
      snapshot,
      lastSection,
      flashMessage,
    });

    renderMeoWorkspace(workspace);
    flashMessage = null;
    const input = (await question(rl, 'Select an item or type "q" to exit: '))
      .trim()
      .toLowerCase();

    if (input === "q") {
      return;
    }

    const item = workspace.items.find((entry) => String(entry.number) === input);
    if (!item) {
      console.log("Invalid workspace selection.\n");
      continue;
    }

    if (
      !(await acknowledgeCriticalItemsIfNeeded(
        rl,
        workspace,
        item.id,
        acknowledgedCriticalItems,
      ))
    ) {
      flashMessage = "Critical compliance acknowledgment was not completed.";
      continue;
    }

    lastSection = item.section;
    flashMessage = await openMeoDetail(
      rl,
      app,
      shipActor,
      workspace.title,
      businessDate,
      snapshot.logs,
      item,
    );
  }
}

function buildMeoWorkspace(input: {
  app: CliApp;
  shipId: string;
  now: string;
  records: FleetRecord[];
  tasks: Task[];
  awarenessRecords: ApprovalAwarenessRecord[];
  snapshot: ReturnType<CliApp["store"]["getSnapshot"]>;
  lastSection: MeoSection;
  flashMessage: string | null;
}): MeoWorkspaceState {
  const shipName = getShipDisplayName(input.app, input.shipId);
  const engineRoomRegisterStatus = getTodayEngineRoomRegisterStatus({
    now: input.now,
    complianceState: input.snapshot.complianceState,
    records: input.records,
  });
  const weeklyReturnStatus = getWeeklyReturnStatus(input.now);
  const monthlyReturnStatus = getMonthlyReturnStatus(input.now);
  const pmsTasks = input.tasks.filter((task) => task.kind === "PMS");
  const overduePmsTasks = pmsTasks.filter((task) => task.status === "OVERDUE");
  const defectRecords = input.records.filter((record) => record.kind === "DEFECT");
  const workRequests = input.records.filter((record) => record.kind === "WORK_REQUEST");
  const overdueOperationalItems = countOverdueOperationalItems({
    tasks: input.tasks,
    awarenessRecords: input.awarenessRecords,
    weeklyStatus: weeklyReturnStatus,
    monthlyStatus: monthlyReturnStatus,
    engineRoomRegisterStatus,
  });

  const items: MeoWorkspaceItem[] = [
    {
      id: "machinery-hours",
      number: 1,
      section: "TODAY",
      title: "Log Machinery Hours",
      summary: `${input.snapshot.logs.length} logs recorded today`,
      status: input.snapshot.complianceState.missingLogs.length > 0
        ? getComplianceStatus({
            dueAt: new Date(new Date(input.now).setHours(23, 59, 59, 999)).toISOString(),
            now: input.now,
          })
        : { label: "OK", priority: 0, dueAt: null, hoursUntilDue: null },
      buildDetail: () => [
        `Ship: ${shipName}`,
        `Business Date: ${input.now.slice(0, 10)}`,
        `Recorded daily logs: ${input.snapshot.logs.length}`,
        `Missing logs: ${input.snapshot.complianceState.missingLogs.join(", ") || "None"}`,
        "Capture propulsion and auxiliary machinery hours before end-of-day compliance checks.",
      ],
    },
    {
      id: "engine-room-register",
      number: 2,
      section: "TODAY",
      title: "Complete Engine Room Register",
      summary: input.snapshot.complianceState.missingLogs.includes("ENGINE_ROOM_REGISTER")
        ? "Register not yet completed"
        : "Register available for review",
      status: engineRoomRegisterStatus,
      buildDetail: () => [
        `Ship: ${shipName}`,
        `Engine Room Register status: ${engineRoomRegisterStatus.label}`,
        `Missing daily logs: ${input.snapshot.complianceState.missingLogs.join(", ") || "None"}`,
        "FMR requires the Engine Room Register to be completed daily and available for CO review.",
      ],
    },
    {
      id: "pms-tasks",
      number: 3,
      section: "TODAY",
      title: "PMS Tasks",
      summary: `${pmsTasks.filter((task) => task.status === "PENDING").length} pending`,
      status: overduePmsTasks.length > 0
        ? { label: "OVERDUE", priority: 2, dueAt: overduePmsTasks[0]?.dueDate ?? null, hoursUntilDue: null }
        : pmsTasks.some((task) => task.status === "PENDING")
          ? { label: "DUE", priority: 1, dueAt: pmsTasks[0]?.dueDate ?? null, hoursUntilDue: null }
          : { label: "OK", priority: 0, dueAt: null, hoursUntilDue: null },
      buildDetail: () => [
        `Assigned PMS tasks: ${pmsTasks.length}`,
        `Pending PMS tasks: ${pmsTasks.filter((task) => task.status === "PENDING").length}`,
        `Overdue PMS tasks: ${overduePmsTasks.length}`,
        "Use this queue to clear weekly engineering maintenance before it slips into overdue status.",
      ],
    },
    {
      id: "defects",
      number: 4,
      section: "MAINTENANCE",
      title: "Defects",
      summary: `${defectRecords.filter((record) => record.approval.status !== "APPROVED").length} open`,
      status: defectRecords.some((record) => record.approval.status === "REJECTED" || record.approval.lastActionReason)
        ? { label: "DUE", priority: 1, dueAt: null, hoursUntilDue: null }
        : { label: "OK", priority: 0, dueAt: null, hoursUntilDue: null },
      buildDetail: () => [
        `Visible defect records: ${defectRecords.length}`,
        `Submitted defects: ${defectRecords.filter((record) => record.approval.status === "SUBMITTED").length}`,
        `Rejected defects: ${defectRecords.filter((record) => record.approval.status === "REJECTED").length}`,
        "Review ship defects here before escalation to support authorities.",
      ],
    },
    {
      id: "maintenance-requests",
      number: 5,
      section: "MAINTENANCE",
      title: "Raise Maintenance Request",
      summary: `${workRequests.length} requests in ship view`,
      status: workRequests.some((record) => record.approval.status === "REJECTED")
        ? { label: "DUE", priority: 1, dueAt: null, hoursUntilDue: null }
        : { label: "OK", priority: 0, dueAt: null, hoursUntilDue: null },
      buildDetail: () => [
        `Visible maintenance requests: ${workRequests.length}`,
        `Submitted requests: ${workRequests.filter((record) => record.approval.status === "SUBMITTED").length}`,
        `Rejected requests: ${workRequests.filter((record) => record.approval.status === "REJECTED").length}`,
        "Use existing ship records and defect evidence to prepare the next maintenance request.",
      ],
    },
    {
      id: "weekly-return",
      number: 6,
      section: "RETURNS",
      title: "Weekly Return",
      summary: formatReturnSummary(weeklyReturnStatus),
      status: weeklyReturnStatus,
      buildDetail: () => [
        `Weekly return status: ${weeklyReturnStatus.label}`,
        `Hours until due: ${weeklyReturnStatus.hoursUntilDue ?? "N/A"}`,
        `Ship records in current view: ${input.records.length}`,
        "Use shipboard engineering activity and open maintenance actions to prepare the weekly return.",
      ],
    },
    {
      id: "monthly-return",
      number: 7,
      section: "RETURNS",
      title: "Monthly Return",
      summary: formatReturnSummary(monthlyReturnStatus),
      status: monthlyReturnStatus,
      buildDetail: () => [
        `Monthly return status: ${monthlyReturnStatus.label}`,
        `Hours until due: ${monthlyReturnStatus.hoursUntilDue ?? "N/A"}`,
        `Visible engineering records: ${input.records.length}`,
        "Use the monthly return to consolidate engineering readiness, maintenance demand, and unresolved support issues.",
      ],
    },
    {
      id: "stores-shortfalls",
      number: 8,
      section: "STORES",
      title: "Stores & Shortfalls",
      summary: `${workRequests.length} open support demands`,
      status: input.tasks.some(
        (task) => task.severity === "URGENT" || task.severity === "CRITICAL",
      )
        ? { label: "DUE", priority: 1, dueAt: null, hoursUntilDue: null }
        : { label: "OK", priority: 0, dueAt: null, hoursUntilDue: null },
      buildDetail: () => [
        `Open support demands: ${workRequests.length}`,
        `Urgent or critical engineering tasks: ${input.tasks.filter((task) => task.severity === "URGENT" || task.severity === "CRITICAL").length}`,
        "Track shortages, urgent spares, and support gaps here before they degrade readiness further.",
      ],
    },
  ];

  const alerts = buildAlerts({
    missingLogs: input.snapshot.complianceState.missingLogs,
    weeklyReturnStatus,
    overdueOperationalItems,
  });
  const todayItems = items.filter((item) => item.section === "TODAY");
  const dailyCompleted = todayItems.filter((item) => item.status.label === "OK").length;
  const dailyPending = todayItems.length - dailyCompleted;

  return {
    title: `MEO WORKSPACE (Ship: ${shipName})`,
    focus: input.lastSection,
    alerts,
    flashMessage: input.flashMessage,
    items,
    dailyStatus: dailyPending === 0 ? "COMPLETE" : "INCOMPLETE",
    dailyCompleted,
    dailyPending,
    criticalAcksRequired: items
      .filter(
        (item) =>
          (item.id === "engine-room-register" || item.id === "weekly-return") &&
          item.status.label !== "OK",
      )
      .map((item) => item.id),
  };
}

function renderMeoWorkspace(workspace: MeoWorkspaceState): void {
  clearScreen();
  console.log(`=== ${workspace.title} ===\n`);
  if (workspace.flashMessage) {
    console.log(`SUCCESS: ${workspace.flashMessage}\n`);
  }
  if (workspace.alerts.length > 0) {
    for (const alert of workspace.alerts) {
      console.log(`! ${alert}`);
    }
    console.log("");
  }

  console.log(
    `Daily Status: ${workspace.dailyStatus} (${workspace.dailyCompleted} completed / ${workspace.dailyPending} pending)\n`,
  );
  console.log(`Focus: ${workspace.focus}\n`);
  renderMeoSection("Today", workspace.items.filter((item) => item.section === "TODAY"));
  renderMeoSection(
    "Maintenance",
    workspace.items.filter((item) => item.section === "MAINTENANCE"),
  );
  renderMeoSection("Returns", workspace.items.filter((item) => item.section === "RETURNS"));
  renderMeoSection("Stores", workspace.items.filter((item) => item.section === "STORES"));
  console.log("[q] Exit\n");
}

function renderMeoSection(title: string, items: MeoWorkspaceItem[]): void {
  console.log(`${title}:`);
  for (const item of items) {
    console.log(
      `[${item.number}] [${item.status.label}] ${item.title}${item.summary ? ` (${item.summary})` : ""}`,
    );
  }
  console.log("");
}

async function openMeoDetail(
  rl: CliPromptLike,
  app: CliApp,
  actor: { role: ActorContext["role"]; shipId: string },
  title: string,
  businessDate: string,
  existingLogs: LogRecord[],
  item: MeoWorkspaceItem,
): Promise<string | null> {
  if (item.id === "engine-room-register") {
    return completeEngineRoomRegisterFlow(
      rl,
      app,
      actor,
      businessDate,
      existingLogs,
    );
  }

  clearScreen();
  console.log(`=== ${title} ===\n`);
  console.log(`${item.title}\n`);
  for (const line of item.buildDetail()) {
    console.log(line);
  }
  console.log("");
  await question(rl, "Press Enter to return...");
  return null;
}

function buildAlerts(input: {
  missingLogs: readonly string[];
  weeklyReturnStatus: ComplianceStatus;
  overdueOperationalItems: number;
}): string[] {
  const alerts: string[] = [];
  if (input.missingLogs.includes("ENGINE_ROOM_REGISTER")) {
    alerts.push("Engine Room Register not completed today");
  }
  if (input.weeklyReturnStatus.label !== "OK") {
    alerts.push(
      input.weeklyReturnStatus.label === "OVERDUE"
        ? "Weekly Return is overdue"
        : `Weekly Return due in ${input.weeklyReturnStatus.hoursUntilDue ?? "N/A"} hours`,
    );
  }
  if (input.overdueOperationalItems > 0) {
    alerts.push(`${input.overdueOperationalItems} overdue items need attention`);
  }
  return alerts;
}

function formatReturnSummary(status: ComplianceStatus): string {
  switch (status.label) {
    case "OVERDUE":
      return "overdue";
    case "DUE":
      return "due";
    case "OK":
      return "upcoming";
    default:
      return "upcoming";
  }
}

async function acknowledgeCriticalItemsIfNeeded(
  rl: CliPromptLike,
  workspace: MeoWorkspaceState,
  selectedItemId: string,
  acknowledgedCriticalItems: Set<string>,
): Promise<boolean> {
  for (const criticalItemId of workspace.criticalAcksRequired) {
    if (criticalItemId === selectedItemId || acknowledgedCriticalItems.has(criticalItemId)) {
      continue;
    }

    const input = (
      await question(
        rl,
        `Critical item pending (${criticalItemId}). Type ACK to proceed without completing it: `,
      )
    )
      .trim()
      .toUpperCase();

    if (input !== "ACK") {
      return false;
    }

    acknowledgedCriticalItems.add(criticalItemId);
  }

  return true;
}

async function completeEngineRoomRegisterFlow(
  rl: CliPromptLike,
  app: CliApp,
  actor: { role: ActorContext["role"]; shipId: string },
  businessDate: string,
  existingLogs: LogRecord[],
): Promise<string> {
  clearScreen();
  console.log("=== ENGINE ROOM REGISTER ===\n");

  if (existingLogs.some((log) => log.logType === "ENGINE_ROOM_REGISTER")) {
    await question(rl, "Engine Room Register already completed. Press Enter to return...");
    return "Engine Room Register was already complete for today.";
  }

  const equipment = await promptRequiredText(rl, "Equipment: ");
  const operatingHours = await promptPositiveNumber(rl, "Operating hours: ");
  const status = await promptChoice(rl, "Status [RUNNING/STANDBY/DEFECTIVE]: ", [
    "RUNNING",
    "STANDBY",
    "DEFECTIVE",
  ]);
  const remarks = await promptOptionalText(rl, "Remarks (optional): ");

  const occurredAt = new Date().toISOString();
  const recordId = `ERR-${actor.shipId}-${businessDate}`;
  const description = JSON.stringify(
    {
      equipment,
      operatingHours,
      status,
      remarks,
    },
    null,
    2,
  );

  app.eventBus.emit(
    createApprovalRecordCreateEvent(
      actor.shipId,
      recordId,
      "MAINTENANCE_LOG",
      `Engine Room Register - ${equipment}`,
      businessDate,
      occurredAt,
      actor.role,
      description,
    ),
  );

  app.store.saveLog({
    shipId: actor.shipId,
    businessDate,
    logType: "ENGINE_ROOM_REGISTER",
    submittedAt: occurredAt,
    submittedByRole: actor.role,
  });
  syncDailyComplianceFromLogs(app, actor.shipId, businessDate, occurredAt);

  return `Engine Room Register saved for ${equipment}.`;
}

async function promptRequiredText(
  rl: CliPromptLike,
  prompt: string,
): Promise<string> {
  while (true) {
    const value = (await question(rl, prompt)).trim();
    if (value !== "") {
      return value;
    }
    console.log("Value is required.");
  }
}

async function promptOptionalText(
  rl: CliPromptLike,
  prompt: string,
): Promise<string | null> {
  const value = (await question(rl, prompt)).trim();
  return value === "" ? null : value;
}

async function promptPositiveNumber(
  rl: CliPromptLike,
  prompt: string,
): Promise<number> {
  while (true) {
    const value = Number((await question(rl, prompt)).trim());
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
    console.log("Enter a valid non-negative number.");
  }
}

async function promptChoice<TChoice extends string>(
  rl: CliPromptLike,
  prompt: string,
  choices: readonly TChoice[],
): Promise<TChoice> {
  while (true) {
    const value = (await question(rl, prompt)).trim().toUpperCase() as TChoice;
    if (choices.includes(value)) {
      return value;
    }
    console.log(`Choose one of: ${choices.join(", ")}`);
  }
}

function syncDailyComplianceFromLogs(
  app: CliApp,
  shipId: string,
  businessDate: string,
  occurredAt: string,
): void {
  const logs = app.store.getLogsForDate(shipId, businessDate);
  const presentLogs = [...new Set(logs.map((log) => log.logType))];
  const complianceState = app.store.getOrCreateComplianceState(shipId, businessDate);
  const missingLogs = complianceState.requiredLogs.filter(
    (logType) => !presentLogs.includes(logType),
  );
  app.store.updateComplianceState(shipId, businessDate, {
    presentLogs,
    missingLogs,
    status: missingLogs.length === 0 ? "COMPLIANT" : "NON_COMPLIANT",
    lastEvaluatedAt: occurredAt,
  });
}
