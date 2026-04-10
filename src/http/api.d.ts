import { Server } from "http";
import { ComplianceEngine } from "../core/engine";
import { InMemoryStore } from "../core/store";
interface ApiDependencies {
    engine: ComplianceEngine;
    store: InMemoryStore;
}
export declare function startApiServer(dependencies: ApiDependencies, port?: number): Server;
export {};
//# sourceMappingURL=api.d.ts.map