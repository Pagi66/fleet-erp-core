import type { ActorContext } from "../src/core/types";
import { buildCommandDashboardView } from "../src/projections/command-dashboard.projection";
import { CliApp, type CliPromptLike } from "./shared";
export interface DashboardCliConfig {
    title: string;
    subtitle?: string;
    renderOverview?: (input: {
        app: CliApp;
        actor: ActorContext;
        view: ReturnType<typeof buildCommandDashboardView>;
    }) => string[];
}
export declare function runCommandDashboardCli(rl: CliPromptLike, app: CliApp, actor: ActorContext, config: DashboardCliConfig): Promise<void>;
//# sourceMappingURL=command-dashboard.cli.d.ts.map