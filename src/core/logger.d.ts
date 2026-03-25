interface LogFields {
    eventType?: string;
    taskId?: string;
    actionType?: string;
    result?: string;
    status?: string;
}
export declare const logger: {
    eventReceived(fields: LogFields): void;
    ruleDecision(fields: LogFields): void;
    actionExecution(fields: LogFields): void;
    stateChange(fields: LogFields): void;
    warn(message: string, fields?: LogFields): void;
    error(message: string, error: unknown, fields?: LogFields): void;
};
export {};
//# sourceMappingURL=logger.d.ts.map