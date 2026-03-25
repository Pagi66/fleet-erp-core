import { Server } from "http";
import { CompleteTaskAction } from "../actions/complete-task.action";
import { EventBus } from "../events/event-system";
import { InMemoryStore } from "../core/store";
interface HttpAppDependencies {
    eventBus: EventBus;
    store: InMemoryStore;
    getHealthCheck: () => ReturnType<InMemoryStore["getHealthCheck"]>;
    completeTaskAction: CompleteTaskAction;
}
export declare function startHttpServer(dependencies: HttpAppDependencies, port?: number): Server;
export {};
//# sourceMappingURL=server.d.ts.map