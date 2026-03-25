import type { ActorContext } from "../src/core/types";
import { runCommandDashboardCli } from "./command-dashboard.cli";
import { CliApp, type CliPromptLike, getShipDisplayName } from "./shared";

export async function runCoCli(
  rl: CliPromptLike,
  app: CliApp,
  actor: ActorContext,
): Promise<void> {
  await runCommandDashboardCli(rl, app, actor, {
    title: "COMMAND DASHBOARD",
    subtitle: actor.shipId
      ? `Command approval view for ${getShipDisplayName(app, actor.shipId)}.`
      : "Command approval view.",
  });
}
