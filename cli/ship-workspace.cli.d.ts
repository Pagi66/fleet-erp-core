import type { ActorContext, FleetRecord, Task } from "../src/core/types";
import { CliApp, type CliPromptLike } from "./shared";
export interface ShipWorkspaceMenuItem {
    label: string;
    buildDetail: (input: WorkspaceBuildInput) => string[];
}
export interface ShipWorkspaceConfig {
    title: string;
    subtitle: string;
    menuItems: readonly ShipWorkspaceMenuItem[];
}
interface WorkspaceBuildInput {
    app: CliApp;
    actor: ActorContext & {
        shipId: string;
    };
    businessDate: string;
    records: FleetRecord[];
    tasks: Task[];
}
export declare function runShipWorkspaceCli(rl: CliPromptLike, app: CliApp, actor: ActorContext, config: ShipWorkspaceConfig): Promise<void>;
export {};
//# sourceMappingURL=ship-workspace.cli.d.ts.map