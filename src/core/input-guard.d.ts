export type SupportedInputGuardEventType = "CREATE_DEFECT" | "COMPLETE_PMS_TASK";
export interface InputGuardDefectState {
    id: string;
    shipId: string;
    title: string;
    status: string;
}
export interface InputGuardTaskState {
    id: string;
    status: string;
}
export interface InputGuardState {
    defects: InputGuardDefectState[];
    tasks: InputGuardTaskState[];
}
export interface CreateDefectEvent {
    type: "CREATE_DEFECT";
    id?: string;
    shipId?: string;
    title?: string;
}
export interface CompletePmsTaskEvent {
    type: "COMPLETE_PMS_TASK";
    taskId?: string;
}
export type InputGuardEvent = CreateDefectEvent | CompletePmsTaskEvent;
export type InputGuardResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare function validateRequiredFields(event: InputGuardEvent): InputGuardResult;
export declare function checkDuplicates(event: InputGuardEvent, state: InputGuardState): InputGuardResult;
export declare function validateState(event: InputGuardEvent, state: InputGuardState): InputGuardResult;
export declare function runInputGuard(event: InputGuardEvent, state: InputGuardState): InputGuardResult;
//# sourceMappingURL=input-guard.d.ts.map