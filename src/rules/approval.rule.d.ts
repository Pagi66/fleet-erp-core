import { InMemoryStore } from "../core/store";
import { EngineEvent, RuleDecision } from "../core/types";
export declare class ApprovalRule {
    evaluate(event: EngineEvent, store: InMemoryStore): RuleDecision;
    private handleCreate;
    private handleSubmit;
    private handleApprove;
    private handleReject;
    private handleStaleCheck;
    private createDecision;
    private createInvalidAttemptDecision;
    private getTransitionIdentityDecision;
    private getTransitionId;
    private asOriginRole;
    private requireActor;
    private getChainRole;
}
//# sourceMappingURL=approval.rule.d.ts.map