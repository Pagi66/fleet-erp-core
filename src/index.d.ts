import { CompleteTaskAction } from "./actions/complete-task.action";
import { ComplianceEngine } from "./core/engine";
import { InMemoryStore } from "./core/store";
import { EventBus } from "./events/event-system";
import { EngineScheduler } from "./events/scheduler";
export declare function createDailyLogEngineApp(): {
    store: InMemoryStore;
    engine: ComplianceEngine;
    eventBus: EventBus;
    scheduler: EngineScheduler;
    completeTaskAction: CompleteTaskAction;
    getHealthCheck: () => import("./core/store").StoreHealthCheck;
    shutdown: () => void;
};
//# sourceMappingURL=index.d.ts.map