import { strict as assert } from "assert";
import {
  getActionBatches,
  getBottlenecks,
  getNextBestAction,
  getOptimizedActionQueue,
  getPatternClusters,
  getRejectionInsights,
} from "../../src/projections/command-dashboard.decision";
import {
  getActionQueue,
  getInitialDashboardState,
  restoreDashboardState,
} from "../../src/projections/command-dashboard.interaction";
import { buildCommandDashboardView } from "../../src/projections/command-dashboard.projection";
import { buildMixedDataset, buildStressDataset, logScenario, withScenarioApp } from "./helpers";

const SCENARIO = "interaction-decision";

export async function runScenario(): Promise<void> {
  await withScenarioApp(SCENARIO, (app) => {
    logScenario(SCENARIO, "testing interaction helpers on mixed dataset");
    const dataset = buildMixedDataset(app, { role: "COMMANDING_OFFICER", shipId: "NNS-ALPHA" });
    const view = buildCommandDashboardView("COMMANDING_OFFICER", dataset.records, dataset.summary);

    const initialState = getInitialDashboardState(view);
    assert.equal(initialState.activeSection, "ACTION_REQUIRED");
    assert.equal(initialState.selectedRecordId, view.sections.actionRequired[0]?.recordId ?? null);

    const actionQueue = getActionQueue("COMMANDING_OFFICER", view);
    assert.deepEqual(
      actionQueue.map((record) => record.recordId),
      getOptimizedActionQueue(view).map((record) => record.recordId),
    );

    const removedRecordId = view.sections.actionRequired[0]?.recordId ?? null;
    const refreshedView = buildCommandDashboardView(
      "COMMANDING_OFFICER",
      dataset.records.filter((record) => record.recordId !== removedRecordId),
      {
        ...dataset.summary,
        totals: {
          ...dataset.summary.totals,
          visible: dataset.summary.totals.visible - (removedRecordId ? 1 : 0),
          needingMyAction: dataset.summary.totals.needingMyAction - (removedRecordId ? 1 : 0),
        },
        records: dataset.summary.records.filter((record) => record.recordId !== removedRecordId),
      },
    );
    const restoredState = restoreDashboardState(
      {
        activeSection: initialState.activeSection,
        selectedRecordId: removedRecordId,
        scrollPosition: 120,
        sectionRecordIds: {
          ACTION_REQUIRED: initialState.sections.ACTION_REQUIRED.recordIds,
          NEEDS_ATTENTION: initialState.sections.NEEDS_ATTENTION.recordIds,
          FOR_AWARENESS: initialState.sections.FOR_AWARENESS.recordIds,
        },
      },
      refreshedView,
    );
    assert.equal(restoredState.activeSection, "ACTION_REQUIRED");
    assert.equal(restoredState.scrollPosition, 120);
    assert.notEqual(restoredState.selectedRecordId, removedRecordId);

    logScenario(SCENARIO, "testing decision acceleration helpers");
    const actionBatches = getActionBatches(view);
    const patternClusters = getPatternClusters(view);
    const bottlenecks = getBottlenecks(view);
    const nextBestAction = getNextBestAction(view);
    const optimizedQueue = getOptimizedActionQueue(view);
    const rejectionInsights = getRejectionInsights(view);

    assert.ok(actionBatches.length > 0);
    assert.ok(patternClusters.length > 0);
    assert.ok(Object.values(bottlenecks.byRole).some((count) => count > 0));
    assert.ok(Object.keys(bottlenecks.byShip).length > 0);
    assert.equal(nextBestAction?.bucket ?? null, "PENDING_MY_ACTION");
    assert.ok(optimizedQueue.every((record) => record.bucket === "PENDING_MY_ACTION"));
    assert.ok(rejectionInsights.every((insight) => insight.count >= 2));

    const decisionSnapshot = JSON.stringify({
      actionBatches,
      patternClusters,
      bottlenecks,
      nextBestAction: nextBestAction?.recordId ?? null,
      optimizedQueue: optimizedQueue.map((record) => record.recordId),
      rejectionInsights,
    });
    const repeatedSnapshot = JSON.stringify({
      actionBatches: getActionBatches(view),
      patternClusters: getPatternClusters(view),
      bottlenecks: getBottlenecks(view),
      nextBestAction: getNextBestAction(view)?.recordId ?? null,
      optimizedQueue: getOptimizedActionQueue(view).map((record) => record.recordId),
      rejectionInsights: getRejectionInsights(view),
    });
    assert.equal(decisionSnapshot, repeatedSnapshot);

    logScenario(SCENARIO, "testing stress scenario");
  });

  await withScenarioApp(`${SCENARIO}-stress`, (app) => {
    const stress = buildStressDataset(app, { role: "LOGISTICS_COMMAND" }, 80);
    const view = buildCommandDashboardView("LOGISTICS_COMMAND", stress.records, stress.summary);
    const queue = getOptimizedActionQueue(view);
    const snapshotOne = JSON.stringify(queue.map((record) => record.recordId));
    const snapshotTwo = JSON.stringify(getOptimizedActionQueue(view).map((record) => record.recordId));

    assert.ok(stress.records.length >= 50);
    assert.equal(snapshotOne, snapshotTwo);
    assert.doesNotThrow(() => getActionBatches(view));
    assert.doesNotThrow(() => getPatternClusters(view));
    assert.doesNotThrow(() => getBottlenecks(view));
  });
}
