import type { ActorContext } from "../src/core/types";
import { runCoCli } from "./co.cli";
import { runFsgCli } from "./fsg.cli";
import { runLogComdCli } from "./logcomd.cli";
import { runMeoCli } from "./meo.cli";
import {
  createCliPrompt,
  type CliPromptLike,
  promptForActorContext,
  promptForRole,
  seedDemoDataIfNeeded,
} from "./shared";
import { runWeoCli } from "./weo.cli";

process.env.LOG_LEVEL ??= "error";

// Load the app after setting the CLI log level.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createDailyLogEngineApp } = require("../src/index") as typeof import("../src/index");

async function main(): Promise<void> {
  const app = createDailyLogEngineApp();
  const rl = createCliPrompt();

  try {
    seedDemoDataIfNeeded(app);
    const role = await promptForRole(rl);
    const actor = await promptForActorContext(rl, app, role);
    await runRoleCli(rl, app, actor);
  } finally {
    rl.close();
    app.shutdown();
  }
}

async function runRoleCli(
  rl: CliPromptLike,
  app: ReturnType<typeof createDailyLogEngineApp>,
  actor: ActorContext,
): Promise<void> {
  switch (actor.role) {
    case "MARINE_ENGINEERING_OFFICER":
      await runMeoCli(rl, app, actor);
      return;
    case "WEAPON_ELECTRICAL_OFFICER":
      await runWeoCli(rl, app, actor);
      return;
    case "COMMANDING_OFFICER":
      await runCoCli(rl, app, actor);
      return;
    case "FLEET_SUPPORT_GROUP":
      await runFsgCli(rl, app, actor);
      return;
    case "LOGISTICS_COMMAND":
      await runLogComdCli(rl, app, actor);
      return;
    default:
      return assertNever(actor.role);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled role: ${String(value)}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
