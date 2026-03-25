import { InMemoryStore } from "../core/store";
import { EngineEvent, RuleDecision } from "../core/types";
export declare class DefectRule {
    evaluate(event: EngineEvent, store: InMemoryStore): RuleDecision;
    private createDecision;
}
//# sourceMappingURL=defect.rule.d.ts.map