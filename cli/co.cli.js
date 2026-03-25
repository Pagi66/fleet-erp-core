"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCoCli = runCoCli;
const command_dashboard_cli_1 = require("./command-dashboard.cli");
const shared_1 = require("./shared");
async function runCoCli(rl, app, actor) {
    await (0, command_dashboard_cli_1.runCommandDashboardCli)(rl, app, actor, {
        title: "COMMAND DASHBOARD",
        subtitle: actor.shipId
            ? `Command approval view for ${(0, shared_1.getShipDisplayName)(app, actor.shipId)}.`
            : "Command approval view.",
    });
}
//# sourceMappingURL=co.cli.js.map