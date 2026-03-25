import { InMemoryStore } from "../core/store";
import { EngineEvent, RuleDecision } from "../core/types";
export declare class PmsTaskRule {
    evaluate(event: EngineEvent, store: InMemoryStore): RuleDecision;
    private createDecision;
}
//# sourceMappingURL=pms-task.rule.d.ts.map