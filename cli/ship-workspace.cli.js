"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runShipWorkspaceCli = runShipWorkspaceCli;
const shared_1 = require("./shared");
async function runShipWorkspaceCli(rl, app, actor, config) {
    if (!actor.shipId) {
        throw new Error(`${config.title} requires a ship-scoped actor context`);
    }
    const shipActor = {
        role: actor.role,
        shipId: actor.shipId,
    };
    while (true) {
        const businessDate = (0, shared_1.getTodayBusinessDate)();
        const records = app.store
            .getApprovalRecordsByShip(shipActor.shipId)
            .filter((record) => record.visibleTo.includes(shipActor.role));
        const tasks = app.store
            .getTasksByShip(shipActor.shipId)
            .filter((task) => task.assignedRole === shipActor.role);
        renderWorkspaceHome(app, shipActor, config, businessDate, records, tasks);
        const input = (await (0, shared_1.question)(rl, 'Choose a workspace item, type "r" to refresh, or "q" to quit: '))
            .trim()
            .toLowerCase();
        if (input === "q") {
            return;
        }
        if (input === "r" || input === "") {
            continue;
        }
        const selectedIndex = Number(input);
        if (!Number.isInteger(selectedIndex) ||
            selectedIndex < 1 ||
            selectedIndex > config.menuItems.length) {
            console.log("Invalid workspace selection.\n");
            continue;
        }
        const menuItem = config.menuItems[selectedIndex - 1];
        if (!menuItem) {
            console.log("Invalid workspace selection.\n");
            continue;
        }
        await openWorkspaceItem(rl, app, shipActor, config.title, menuItem, businessDate, records, tasks);
    }
}
function renderWorkspaceHome(app, actor, config, businessDate, records, tasks) {
    (0, shared_1.clearScreen)();
    const snapshot = app.store.getSnapshot(actor.shipId, businessDate);
    const pendingApprovals = records.filter((record) => record.approval.currentOwner === actor.role &&
        record.approval.status === "SUBMITTED").length;
    console.log(`=== ${config.title} ===\n`);
    console.log(`${config.subtitle}\n`);
    console.log(`Ship: ${(0, shared_1.getShipDisplayName)(app, actor.shipId)}`);
    console.log(`${(0, shared_1.formatCount)("Logs", snapshot.logs.length)} | ${(0, shared_1.formatCount)("Missing", snapshot.complianceState.missingLogs.length)} | ${(0, shared_1.formatCount)("Assigned Tasks", tasks.length)} | ${(0, shared_1.formatCount)("Pending Approvals", pendingApprovals)}`);
    console.log("");
    config.menuItems.forEach((item, index) => {
        console.log(`${index + 1}. ${item.label}`);
    });
    console.log("");
}
async function openWorkspaceItem(rl, app, actor, title, menuItem, businessDate, records, tasks) {
    (0, shared_1.clearScreen)();
    console.log(`=== ${title} ===\n`);
    console.log(`${menuItem.label}\n`);
    for (const line of menuItem.buildDetail({
        app,
        actor,
        businessDate,
        records,
        tasks,
    })) {
        console.log(line);
    }
    console.log("");
    await (0, shared_1.question)(rl, "Press Enter to return...");
}
//# sourceMappingURL=ship-workspace.cli.js.map