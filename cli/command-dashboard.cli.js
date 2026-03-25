"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommandDashboardCli = runCommandDashboardCli;
const approval_events_1 = require("../src/events/approval-events");
const command_dashboard_projection_1 = require("../src/projections/command-dashboard.projection");
const command_dashboard_interaction_1 = require("../src/projections/command-dashboard.interaction");
const command_dashboard_decision_1 = require("../src/projections/command-dashboard.decision");
const shared_1 = require("./shared");
async function runCommandDashboardCli(rl, app, actor, config) {
    let previousState = null;
    while (true) {
        const dashboardState = buildDashboardState(app, actor, previousState);
        renderDashboard(dashboardState.selections, dashboardState.view, app, actor, config);
        const input = (await (0, shared_1.question)(rl, 'Select a record number or type "r" to refresh or "q" to quit: '))
            .trim()
            .toLowerCase();
        if (input === "q") {
            return;
        }
        if (input === "r" || input === "") {
            previousState = toPreviousState(dashboardState.navigation, dashboardState.navigation.selectedRecordId);
            continue;
        }
        const selected = dashboardState.selections.find((selection) => String(selection.index) === input);
        if (!selected) {
            console.log("Invalid selection.\n");
            continue;
        }
        previousState = await openRecordDetail(rl, app, actor, selected, dashboardState.navigation);
    }
}
function buildDashboardState(app, actor, previousState) {
    const now = new Date().toISOString();
    const records = app.store.getApprovalAwarenessRecords(actor, { now });
    const summary = app.store.getApprovalDashboardSummary(actor, { now });
    const baseView = (0, command_dashboard_projection_1.buildCommandDashboardView)(actor.role, records, summary);
    const optimizedView = {
        ...baseView,
        sections: {
            ...baseView.sections,
            actionRequired: [...(0, command_dashboard_decision_1.getOptimizedActionQueue)(baseView)],
        },
    };
    const navigation = previousState
        ? (0, command_dashboard_interaction_1.restoreDashboardState)(previousState, optimizedView)
        : (0, command_dashboard_interaction_1.getInitialDashboardState)(optimizedView);
    return {
        view: optimizedView,
        navigation,
        selections: enumerateSelections(optimizedView),
    };
}
function renderDashboard(selections, view, app, actor, config) {
    (0, shared_1.clearScreen)();
    console.log(`=== ${config.title} ===\n`);
    if (config.subtitle) {
        console.log(`${config.subtitle}\n`);
    }
    if (config.renderOverview) {
        const lines = config.renderOverview({ app, actor, view });
        for (const line of lines) {
            console.log(line);
        }
        if (lines.length > 0) {
            console.log("");
        }
    }
    console.log(`Pending: ${view.summary.pending} | Stale: ${view.summary.stale} | Rejected: ${view.summary.rejected} | Total: ${view.summary.total}\n`);
    renderSection("ACTION REQUIRED", selections.filter((entry) => entry.section === "ACTION_REQUIRED"));
    renderSection("NEEDS ATTENTION", selections.filter((entry) => entry.section === "NEEDS_ATTENTION"));
    renderSection("FOR AWARENESS", selections.filter((entry) => entry.section === "FOR_AWARENESS"));
}
function renderSection(title, selections) {
    console.log(`[${title}]`);
    if (selections.length === 0) {
        console.log("(empty)\n");
        return;
    }
    for (const selection of selections) {
        const card = (0, command_dashboard_interaction_1.toCommandDashboardCardView)(selection.record);
        console.log(`${selection.index}. [${card.ship.name}] ${card.title} (${(0, shared_1.formatAge)(card.ageHoursSinceLastAction)})`);
    }
    console.log("");
}
async function openRecordDetail(rl, app, actor, selection, navigation) {
    while (true) {
        (0, shared_1.clearScreen)();
        const card = (0, command_dashboard_interaction_1.toCommandDashboardCardView)(selection.record);
        const detailView = app.store.getApprovalRecordViewForActor(selection.record.recordId, actor);
        const detailRecord = detailView.record;
        console.log("=== RECORD DETAIL ===\n");
        console.log(`Title: ${card.title}`);
        console.log(`Ship: ${card.ship.name}`);
        console.log(`Status: ${detailRecord?.approval.status ?? card.status}`);
        console.log(`Owner: ${detailRecord?.approval.currentOwner ?? card.currentOwner}`);
        console.log(`Age: ${(0, shared_1.formatAge)(card.ageHoursSinceLastAction)}`);
        console.log("");
        console.log(`Reason: ${detailRecord?.approval.lastActionReason ?? card.reason ?? "N/A"}`);
        console.log(`Note: ${detailRecord?.approval.lastActionNote ?? card.note ?? "N/A"}`);
        console.log("");
        console.log("Actions:");
        console.log("1. Approve");
        console.log("2. Reject");
        console.log("3. Back");
        const input = (await (0, shared_1.question)(rl, "Choose an action: ")).trim();
        if (input === "3" || input.toLowerCase() === "b") {
            return toPreviousState(navigation, selection.record.recordId);
        }
        if (input === "1") {
            if (!(0, shared_1.isActionableForRole)(selection.record, actor.role)) {
                console.log("\nApprove is only available for ACTION REQUIRED records owned by your role.");
                await (0, shared_1.question)(rl, "Press Enter to continue...");
                continue;
            }
            app.eventBus.emit((0, approval_events_1.createApprovalTransitionEvent)("APPROVAL_RECORD_APPROVE", selection.record.shipId, selection.record.recordId, selection.record.businessDate, new Date().toISOString(), actor.role, (0, shared_1.buildTransitionId)(selection.record.recordId, "approve")));
            return toPreviousState(navigation, selection.record.recordId);
        }
        if (input === "2") {
            if (!(0, shared_1.isActionableForRole)(selection.record, actor.role)) {
                console.log("\nReject is only available for ACTION REQUIRED records owned by your role.");
                await (0, shared_1.question)(rl, "Press Enter to continue...");
                continue;
            }
            const reason = (await (0, shared_1.question)(rl, "Enter rejection reason: ")).trim();
            if (reason === "") {
                console.log("\nA rejection reason is required.");
                await (0, shared_1.question)(rl, "Press Enter to continue...");
                continue;
            }
            app.eventBus.emit((0, approval_events_1.createApprovalTransitionEvent)("APPROVAL_RECORD_REJECT", selection.record.shipId, selection.record.recordId, selection.record.businessDate, new Date().toISOString(), actor.role, (0, shared_1.buildTransitionId)(selection.record.recordId, "reject"), reason));
            return toPreviousState(navigation, selection.record.recordId);
        }
        console.log("\nInvalid action.");
        await (0, shared_1.question)(rl, "Press Enter to continue...");
    }
}
function enumerateSelections(view) {
    const selections = [];
    let index = 1;
    for (const record of view.sections.actionRequired) {
        selections.push({ index, section: "ACTION_REQUIRED", record });
        index += 1;
    }
    for (const record of view.sections.needsAttention) {
        selections.push({ index, section: "NEEDS_ATTENTION", record });
        index += 1;
    }
    for (const record of view.sections.forAwareness) {
        selections.push({ index, section: "FOR_AWARENESS", record });
        index += 1;
    }
    return selections;
}
function toPreviousState(navigation, selectedRecordId) {
    return {
        activeSection: navigation.activeSection,
        selectedRecordId,
        scrollPosition: navigation.scrollPosition,
        sectionRecordIds: {
            ACTION_REQUIRED: navigation.sections.ACTION_REQUIRED.recordIds,
            NEEDS_ATTENTION: navigation.sections.NEEDS_ATTENTION.recordIds,
            FOR_AWARENESS: navigation.sections.FOR_AWARENESS.recordIds,
        },
    };
}
//# sourceMappingURL=command-dashboard.cli.js.map