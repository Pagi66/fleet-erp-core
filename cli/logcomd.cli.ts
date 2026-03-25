import type { ActorContext } from "../src/core/types";
import { runCommandDashboardCli } from "./command-dashboard.cli";
import { CliApp, type CliPromptLike } from "./shared";

export async function runLogComdCli(
  rl: CliPromptLike,
  app: CliApp,
  actor: ActorContext,
): Promise<void> {
  await runCommandDashboardCli(rl, app, actor, {
    title: "LOG COMD FLEET CONSOLE",
    subtitle: "Fleet backlog, maintenance planning, and final approval oversight.",
    renderOverview: ({ view }) => {
      const allRecords = [
        ...view.sections.actionRequired,
        ...view.sections.needsAttention,
        ...view.sections.forAwareness,
      ];
      const fleetShips = new Set(allRecords.map((record) => record.shipId)).size;
      const backlog = allRecords.filter((record) => record.status === "SUBMITTED").length;
      const planningQueue = allRecords.filter(
        (record) => record.kind === "WORK_REQUEST" || record.kind === "DEFECT",
      ).length;

      return [
        `Fleet ships in view: ${fleetShips}`,
        `Backlog under review: ${backlog}`,
        `Maintenance planning queue: ${planningQueue}`,
      ];
    },
  });
}
