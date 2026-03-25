import type { ActorContext } from "../src/core/types";
import { runCommandDashboardCli } from "./command-dashboard.cli";
import { CliApp, type CliPromptLike } from "./shared";

export async function runFsgCli(
  rl: CliPromptLike,
  app: CliApp,
  actor: ActorContext,
): Promise<void> {
  await runCommandDashboardCli(rl, app, actor, {
    title: "FSG REVIEW CONSOLE",
    subtitle: "Intermediate maintenance review, defect oversight, and ILM planning watch.",
    renderOverview: ({ view }) => {
      const actionRequired = view.sections.actionRequired;
      const allRecords = [
        ...view.sections.actionRequired,
        ...view.sections.needsAttention,
        ...view.sections.forAwareness,
      ];
      const maintenanceRequests = actionRequired.filter(
        (record) => record.kind === "WORK_REQUEST",
      ).length;
      const defects = allRecords.filter((record) => record.kind === "DEFECT").length;
      const stalePlanning = allRecords.filter((record) => record.computed.isStale).length;

      return [
        `Maintenance requests queue: ${maintenanceRequests}`,
        `Defect reports in view: ${defects}`,
        `ILM planning watchlist: ${stalePlanning}`,
      ];
    },
  });
}
