import { readFileSync } from "fs";
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
import type { createDailyLogEngineApp } from "../src/index";

export type CliApp = ReturnType<typeof createDailyLogEngineApp>;

export interface CliPromptLike {
  question(prompt: string, callback: (answer: string) => void): void;
  close(): void;
}

export const IS_SCRIPT_MODE = process.argv.includes("--script-mode");
export const SHOULD_CLEAR_SCREEN =
  !process.argv.includes("--no-clear") && !IS_SCRIPT_MODE;

export function createCliPrompt(): CliPromptLike {
  if (!IS_SCRIPT_MODE) {
    return readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  const raw = readFileSync(0, "utf8");
  const queue = raw.split(/\r?\n/);

  return {
    question(prompt: string, callback: (answer: string) => void): void {
      process.stdout.write(prompt);
      const answer = queue.shift() ?? "";
      process.stdout.write(`${answer}\n`);
      callback(answer);
    },
    close(): void {
      queue.length = 0;
    },
  };
}

export async function question(
  rl: CliPromptLike,
  prompt: string,
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

export function clearScreen(): void {
  if (SHOULD_CLEAR_SCREEN) {
    console.clear();
  }
}

export function formatAge(ageHoursSinceLastAction: number | null): string {
  return ageHoursSinceLastAction === null ? "N/A" : `${ageHoursSinceLastAction}h`;
}

export function formatCount(label: string, count: number): string {
  return `${label}: ${count}`;
}

export function getTodayBusinessDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function requiresShipContext(role: AssignedRoleId): boolean {
  return (
    role === "MARINE_ENGINEERING_OFFICER" ||
    role === "WEAPON_ELECTRICAL_OFFICER" ||
    role === "COMMANDING_OFFICER"
  );
}

export function isActionableForRole(
  record: ApprovalAwarenessRecord,
  role: AssignedRoleId,
): boolean {
  return (
    record.bucket === "PENDING_MY_ACTION" &&
    record.status === "SUBMITTED" &&
    record.currentOwner === role
  );
}

export function buildTransitionId(
  recordId: string,
  action: "approve" | "reject",
): string {
  return `cli:${action}:${recordId}:${Date.now()}`;
}

export function getShipDisplayName(app: CliApp, shipId: string): string {
  const ship = app.store.getAllShips().find((entry) => entry.id === shipId);
  return ship ? `${ship.name} (${ship.id})` : shipId;
}

export async function promptForRole(
  rl: CliPromptLike,
): Promise<AssignedRoleId> {
  console.log("Select role:");
  console.log("1. MEO");
  console.log("2. CO");
  console.log("3. WEO");
  console.log("4. FSG");
  console.log("5. LOG_COMD");

  while (true) {
    const input = (await question(rl, "Role [1-5]: ")).trim();
    switch (input) {
      case "1":
        return "MARINE_ENGINEERING_OFFICER";
      case "2":
        return "COMMANDING_OFFICER";
      case "3":
        return "WEAPON_ELECTRICAL_OFFICER";
      case "4":
        return "FLEET_SUPPORT_GROUP";
      case "5":
        return "LOGISTICS_COMMAND";
      default:
        console.log("Invalid role selection.");
        break;
    }
  }
}

export async function promptForActorContext(
  rl: CliPromptLike,
  app: CliApp,
  role: AssignedRoleId,
): Promise<ActorContext> {
  if (!requiresShipContext(role)) {
    return { role };
  }

  return {
    role,
    shipId: await promptForShipId(rl, app),
  };
}

export async function promptForShipId(
  rl: CliPromptLike,
  app: CliApp,
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

export function seedDemoDataIfNeeded(app: CliApp): void {
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

function seedRecord(
  app: CliApp,
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
  const submitAt = new Date(
    new Date(input.createdAt).getTime() + 30 * 60 * 1000,
  ).toISOString();
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

  const decisionAt = new Date(
    new Date(submitAt).getTime() + 30 * 60 * 1000,
  ).toISOString();

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
  const fsgAt = new Date(
    new Date(decisionAt).getTime() + 30 * 60 * 1000,
  ).toISOString();
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
