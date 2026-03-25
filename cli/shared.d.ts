import type { ActorContext, ApprovalAwarenessRecord, AssignedRoleId } from "../src/core/types";
import type { createDailyLogEngineApp } from "../src/index";
export type CliApp = ReturnType<typeof createDailyLogEngineApp>;
export interface CliPromptLike {
    question(prompt: string, callback: (answer: string) => void): void;
    close(): void;
}
export declare const IS_SCRIPT_MODE: boolean;
export declare const SHOULD_CLEAR_SCREEN: boolean;
export declare function createCliPrompt(): CliPromptLike;
export declare function question(rl: CliPromptLike, prompt: string): Promise<string>;
export declare function clearScreen(): void;
export declare function formatAge(ageHoursSinceLastAction: number | null): string;
export declare function formatCount(label: string, count: number): string;
export declare function getTodayBusinessDate(): string;
export declare function requiresShipContext(role: AssignedRoleId): boolean;
export declare function isActionableForRole(record: ApprovalAwarenessRecord, role: AssignedRoleId): boolean;
export declare function buildTransitionId(recordId: string, action: "approve" | "reject"): string;
export declare function getShipDisplayName(app: CliApp, shipId: string): string;
export declare function promptForRole(rl: CliPromptLike): Promise<AssignedRoleId>;
export declare function promptForActorContext(rl: CliPromptLike, app: CliApp, role: AssignedRoleId): Promise<ActorContext>;
export declare function promptForShipId(rl: CliPromptLike, app: CliApp): Promise<string>;
export declare function seedDemoDataIfNeeded(app: CliApp): void;
//# sourceMappingURL=shared.d.ts.map