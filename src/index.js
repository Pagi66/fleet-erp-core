"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDailyLogEngineApp = createDailyLogEngineApp;
const audit_approval_invalid_attempt_action_1 = require("./actions/audit-approval-invalid-attempt.action");
const approve_approval_record_action_1 = require("./actions/approve-approval-record.action");
const create_approval_record_action_1 = require("./actions/create-approval-record.action");
const escalate_co_action_1 = require("./actions/escalate-co.action");
const check_task_action_1 = require("./actions/check-task.action");
const complete_task_action_1 = require("./actions/complete-task.action");
const create_defect_task_action_1 = require("./actions/create-defect-task.action");
const create_pms_task_action_1 = require("./actions/create-pms-task.action");
const escalate_defect_to_log_comd_action_1 = require("./actions/escalate-defect-to-log-comd.action");
const escalate_defect_to_mcc_action_1 = require("./actions/escalate-defect-to-mcc.action");
const mark_compliance_action_1 = require("./actions/mark-compliance.action");
const mark_pms_task_overdue_action_1 = require("./actions/mark-pms-task-overdue.action");
const notify_meo_action_1 = require("./actions/notify-meo.action");
const notify_approval_owner_action_1 = require("./actions/notify-approval-owner.action");
const notify_pms_supervisor_action_1 = require("./actions/notify-pms-supervisor.action");
const reject_approval_record_action_1 = require("./actions/reject-approval-record.action");
const replan_pms_task_action_1 = require("./actions/replan-pms-task.action");
const submit_approval_record_action_1 = require("./actions/submit-approval-record.action");
const engine_1 = require("./core/engine");
const logger_1 = require("./core/logger");
const store_1 = require("./core/store");
const event_system_1 = require("./events/event-system");
const scheduler_1 = require("./events/scheduler");
const server_1 = require("./http/server");
const approval_rule_1 = require("./rules/approval.rule");
const daily_log_rule_1 = require("./rules/daily-log.rule");
const defect_rule_1 = require("./rules/defect.rule");
const pms_task_rule_1 = require("./rules/pms-task.rule");
function createDailyLogEngineApp() {
    const store = new store_1.InMemoryStore();
    const approvalRule = new approval_rule_1.ApprovalRule();
    const dailyLogRule = new daily_log_rule_1.DailyLogRule();
    const pmsTaskRule = new pms_task_rule_1.PmsTaskRule();
    const defectRule = new defect_rule_1.DefectRule();
    const eventBus = new event_system_1.EventBus();
    const auditApprovalInvalidAttemptAction = new audit_approval_invalid_attempt_action_1.AuditApprovalInvalidAttemptAction();
    const createApprovalRecordAction = new create_approval_record_action_1.CreateApprovalRecordAction();
    const submitApprovalRecordAction = new submit_approval_record_action_1.SubmitApprovalRecordAction();
    const approveApprovalRecordAction = new approve_approval_record_action_1.ApproveApprovalRecordAction();
    const rejectApprovalRecordAction = new reject_approval_record_action_1.RejectApprovalRecordAction();
    const notifyApprovalOwnerAction = new notify_approval_owner_action_1.NotifyApprovalOwnerAction();
    const markComplianceAction = new mark_compliance_action_1.MarkComplianceAction();
    const notifyMeoAction = new notify_meo_action_1.NotifyMeoAction();
    const escalateCoAction = new escalate_co_action_1.EscalateCoAction();
    const checkTaskAction = new check_task_action_1.CheckTaskAction();
    const completeTaskAction = new complete_task_action_1.CompleteTaskAction();
    const createPmsTaskAction = new create_pms_task_action_1.CreatePmsTaskAction();
    const createDefectTaskAction = new create_defect_task_action_1.CreateDefectTaskAction();
    const markPmsTaskOverdueAction = new mark_pms_task_overdue_action_1.MarkPmsTaskOverdueAction();
    const replanPmsTaskAction = new replan_pms_task_action_1.ReplanPmsTaskAction();
    const notifyPmsSupervisorAction = new notify_pms_supervisor_action_1.NotifyPmsSupervisorAction();
    const escalateDefectToMccAction = new escalate_defect_to_mcc_action_1.EscalateDefectToMccAction();
    const escalateDefectToLogComdAction = new escalate_defect_to_log_comd_action_1.EscalateDefectToLogComdAction();
    const engine = new engine_1.ComplianceEngine({
        store,
        approvalRule,
        auditApprovalInvalidAttemptAction,
        dailyLogRule,
        pmsTaskRule,
        defectRule,
        createApprovalRecordAction,
        submitApprovalRecordAction,
        approveApprovalRecordAction,
        rejectApprovalRecordAction,
        notifyApprovalOwnerAction,
        markComplianceAction,
        notifyMeoAction,
        escalateCoAction,
        checkTaskAction,
        createPmsTaskAction,
        createDefectTaskAction,
        markPmsTaskOverdueAction,
        replanPmsTaskAction,
        notifyPmsSupervisorAction,
        escalateDefectToMccAction,
        escalateDefectToLogComdAction,
        eventBus,
    });
    const scheduler = new scheduler_1.EngineScheduler(eventBus, () => store.getAllShips().map((ship) => ship.id));
    return {
        store,
        engine,
        eventBus,
        scheduler,
        completeTaskAction,
        getHealthCheck: () => store.getHealthCheck(),
        shutdown: () => {
            store.flush();
            scheduler.stop();
            engine.stop();
        },
    };
}
if (require.main === module) {
    const app = createDailyLogEngineApp();
    const health = app.getHealthCheck();
    const server = (0, server_1.startHttpServer)({
        eventBus: app.eventBus,
        store: app.store,
        getHealthCheck: app.getHealthCheck,
        completeTaskAction: app.completeTaskAction,
    });
    logger_1.logger.stateChange({
        eventType: "SYSTEM_STARTUP",
        status: "RUNNING",
        result: `tasks=${health.totalTasks},overdue=${health.overdueTasks},lastPersisted=${health.lastPersistenceTimestamp ?? "none"}`,
    });
    app.scheduler.start();
    const gracefulShutdown = (signal) => {
        try {
            logger_1.logger.stateChange({
                eventType: signal,
                status: "SHUTTING_DOWN",
            });
            server.close();
            app.shutdown();
            logger_1.logger.stateChange({
                eventType: signal,
                status: "STOPPED",
            });
            process.exit(0);
        }
        catch (error) {
            logger_1.logger.error("graceful_shutdown_failed", error, {
                eventType: signal,
                status: "FAILED",
            });
            process.exit(1);
        }
    };
    process.once("SIGINT", () => gracefulShutdown("SIGINT"));
    process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
}
//# sourceMappingURL=index.js.map