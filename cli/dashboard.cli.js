"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const co_cli_1 = require("./co.cli");
const fsg_cli_1 = require("./fsg.cli");
const logcomd_cli_1 = require("./logcomd.cli");
const meo_cli_1 = require("./meo.cli");
const shared_1 = require("./shared");
const weo_cli_1 = require("./weo.cli");
(_a = process.env).LOG_LEVEL ?? (_a.LOG_LEVEL = "error");
// Load the app after setting the CLI log level.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createDailyLogEngineApp } = require("../src/index");
async function main() {
    const app = createDailyLogEngineApp();
    const rl = (0, shared_1.createCliPrompt)();
    try {
        (0, shared_1.seedDemoDataIfNeeded)(app);
        const role = await (0, shared_1.promptForRole)(rl);
        const actor = await (0, shared_1.promptForActorContext)(rl, app, role);
        await runRoleCli(rl, app, actor);
    }
    finally {
        rl.close();
        app.shutdown();
    }
}
async function runRoleCli(rl, app, actor) {
    switch (actor.role) {
        case "MARINE_ENGINEERING_OFFICER":
            await (0, meo_cli_1.runMeoCli)(rl, app, actor);
            return;
        case "WEAPON_ELECTRICAL_OFFICER":
            await (0, weo_cli_1.runWeoCli)(rl, app, actor);
            return;
        case "COMMANDING_OFFICER":
            await (0, co_cli_1.runCoCli)(rl, app, actor);
            return;
        case "FLEET_SUPPORT_GROUP":
            await (0, fsg_cli_1.runFsgCli)(rl, app, actor);
            return;
        case "LOGISTICS_COMMAND":
            await (0, logcomd_cli_1.runLogComdCli)(rl, app, actor);
            return;
        default:
            return assertNever(actor.role);
    }
}
function assertNever(value) {
    throw new Error(`Unhandled role: ${String(value)}`);
}
void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=dashboard.cli.js.map