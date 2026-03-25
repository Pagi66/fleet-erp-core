import { strict as assert } from "assert";
import { buildCommandDashboardView } from "../../src/projections/command-dashboard.projection";
import { assertNoDuplicateRecordIds, buildMixedDataset, logScenario, withScenarioApp } from "./helpers";

const SCENARIO = "awareness-projection";

export async function runScenario(): Promise<void> {
  await withScenarioApp(SCENARIO, (app) => {
    logScenario(SCENARIO, "building mixed awareness dataset");
    const dataset = buildMixedDataset(app, { role: "LOGISTICS_COMMAND" });

    assert.ok(dataset.records.length >= 20);
    assert.equal(dataset.summary.totals.visible, dataset.records.length);
    assert.equal(
      Object.values(dataset.summary.countsByStatus).reduce((sum, count) => sum + count, 0),
      dataset.records.length,
    );
    assert.ok(dataset.records.every((record) => record.visibleTo.includes("LOGISTICS_COMMAND")));

    const view = buildCommandDashboardView(
      "LOGISTICS_COMMAND",
      dataset.records,
      dataset.summary,
    );
    const allSectionIds = [
      ...view.sections.actionRequired.map((record) => record.recordId),
      ...view.sections.needsAttention.map((record) => record.recordId),
      ...view.sections.forAwareness.map((record) => record.recordId),
    ];
    assertNoDuplicateRecordIds(allSectionIds);
    assert.equal(allSectionIds.length, dataset.records.length);

    const duplicateView = buildCommandDashboardView(
      "LOGISTICS_COMMAND",
      dataset.records,
      dataset.summary,
    );
    assert.equal(JSON.stringify(view), JSON.stringify(duplicateView));
  });
}
