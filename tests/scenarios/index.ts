import { mkdirSync } from "fs";
import { resolve } from "path";

async function main(): Promise<void> {
  const persistencePath = resolve(
    process.cwd(),
    "tests/scenarios/.tmp/store-state.json",
  );
  mkdirSync(resolve(process.cwd(), "tests/scenarios/.tmp"), { recursive: true });
  process.env.PERSISTENCE_FILE_PATH = persistencePath;
  process.env.EVENT_DEBOUNCE_WINDOW_MS = "0";
  process.env.LOG_LEVEL = "silent";

  const scenarioModules = [
    "./approval-flow.scenario",
    "./rejection-flow.scenario",
    "./multi-role-flow.scenario",
    "./awareness-projection.scenario",
    "./interaction-decision.scenario",
  ];

  for (const modulePath of scenarioModules) {
    const scenario = await import(modulePath);
    const nameParts = modulePath.split("/");
    const scenarioName = nameParts[nameParts.length - 1] ?? modulePath;
    process.stdout.write(`SCENARIO ${scenarioName}: START\n`);
    try {
      await scenario.runScenario();
      process.stdout.write(`SCENARIO ${scenarioName}: PASS\n`);
    } catch (error) {
      process.stdout.write(`SCENARIO ${scenarioName}: FAIL\n`);
      throw error;
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
