"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLogComdCli = runLogComdCli;
const command_dashboard_cli_1 = require("./command-dashboard.cli");
async function runLogComdCli(rl, app, actor) {
    await (0, command_dashboard_cli_1.runCommandDashboardCli)(rl, app, actor, {
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
            const planningQueue = allRecords.filter((record) => record.kind === "WORK_REQUEST" || record.kind === "DEFECT").length;
            return [
                `Fleet ships in view: ${fleetShips}`,
                `Backlog under review: ${backlog}`,
                `Maintenance planning queue: ${planningQueue}`,
            ];
        },
    });
}
//# sourceMappingURL=logcomd.cli.js.map