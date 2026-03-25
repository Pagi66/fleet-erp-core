import { EngineEvent, RuleDecision } from "../core/types";
import { InMemoryStore } from "../core/store";
export declare class DailyLogRule {
    evaluate(event: EngineEvent, store: InMemoryStore): RuleDecision;
    private collectPresentLogs;
    private createCommand;
    private createDecision;
}
//# sourceMappingURL=daily-log.rule.d.ts.map