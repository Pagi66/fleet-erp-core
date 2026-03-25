"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFsgCli = runFsgCli;
const command_dashboard_cli_1 = require("./command-dashboard.cli");
async function runFsgCli(rl, app, actor) {
    await (0, command_dashboard_cli_1.runCommandDashboardCli)(rl, app, actor, {
        title: "FSG REVIEW CONSOLE",
        subtitle: "Intermediate maintenance review, defect oversight, and ILM planning watch.",
        renderOverview: ({ view }) => {
            const actionRequired = view.sections.actionRequired;
            const allRecords = [
                ...view.sections.actionRequired,
                ...view.sections.needsAttention,
                ...view.sections.forAwareness,
            ];
            const maintenanceRequests = actionRequired.filter((record) => record.kind === "WORK_REQUEST").length;
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
//# sourceMappingURL=fsg.cli.js.map