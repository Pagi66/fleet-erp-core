import { AuditApprovalInvalidAttemptAction } from "./actions/audit-approval-invalid-attempt.action";
import { ApproveApprovalRecordAction } from "./actions/approve-approval-record.action";
import { CreateApprovalRecordAction } from "./actions/create-approval-record.action";
import { CreateDefectAction } from "./actions/create-defect.action";
import { EscalateCoAction } from "./actions/escalate-co.action";
import { CheckTaskAction } from "./actions/check-task.action";
import { CompleteTaskAction } from "./actions/complete-task.action";
import { CreateDefectTaskAction } from "./actions/create-defect-task.action";
import { CreatePmsTaskAction } from "./actions/create-pms-task.action";
import { EscalateDefectToLogComdAction } from "./actions/escalate-defect-to-log-comd.action";
import { EscalateDefectToMccAction } from "./actions/escalate-defect-to-mcc.action";
import { MarkComplianceAction } from "./actions/mark-compliance.action";
import { MarkPmsTaskOverdueAction } from "./actions/mark-pms-task-overdue.action";
import { NotifyMeoAction } from "./actions/notify-meo.action";
import { NotifyApprovalOwnerAction } from "./actions/notify-approval-owner.action";
import { NotifyPmsSupervisorAction } from "./actions/notify-pms-supervisor.action";
import { RejectApprovalRecordAction } from "./actions/reject-approval-record.action";
import { ReplanPmsTaskAction } from "./actions/replan-pms-task.action";
import { SubmitApprovalRecordAction } from "./actions/submit-approval-record.action";
import { ComplianceEngine } from "./core/engine";
import { logger } from "./core/logger";
import { InMemoryStore } from "./core/store";
import { EventBus } from "./events/event-system";
import { EngineScheduler } from "./events/scheduler";
import { startHttpServer } from "./http/server";
import { ApprovalRule } from "./rules/approval.rule";
import { DailyLogRule } from "./rules/daily-log.rule";
import { DefectRule } from "./rules/defect.rule";
import { PmsTaskRule } from "./rules/pms-task.rule";

export function createDailyLogEngineApp() {
  const store = new InMemoryStore();
  const approvalRule = new ApprovalRule();
  const dailyLogRule = new DailyLogRule();
  const pmsTaskRule = new PmsTaskRule();
  const defectRule = new DefectRule();
  const eventBus = new EventBus();
  const auditApprovalInvalidAttemptAction = new AuditApprovalInvalidAttemptAction();
  const createApprovalRecordAction = new CreateApprovalRecordAction();
  const createDefectAction = new CreateDefectAction();
  const submitApprovalRecordAction = new SubmitApprovalRecordAction();
  const approveApprovalRecordAction = new ApproveApprovalRecordAction();
  const rejectApprovalRecordAction = new RejectApprovalRecordAction();
  const notifyApprovalOwnerAction = new NotifyApprovalOwnerAction();
  const markComplianceAction = new MarkComplianceAction();
  const notifyMeoAction = new NotifyMeoAction();
  const escalateCoAction = new EscalateCoAction();
  const checkTaskAction = new CheckTaskAction();
  const completeTaskAction = new CompleteTaskAction();
  const createPmsTaskAction = new CreatePmsTaskAction();
  const createDefectTaskAction = new CreateDefectTaskAction();
  const markPmsTaskOverdueAction = new MarkPmsTaskOverdueAction();
  const replanPmsTaskAction = new ReplanPmsTaskAction();
  const notifyPmsSupervisorAction = new NotifyPmsSupervisorAction();
  const escalateDefectToMccAction = new EscalateDefectToMccAction();
  const escalateDefectToLogComdAction = new EscalateDefectToLogComdAction();

  const engine = new ComplianceEngine({
    store,
    approvalRule,
    auditApprovalInvalidAttemptAction,
    dailyLogRule,
    pmsTaskRule,
    defectRule,
    createApprovalRecordAction,
    createDefectAction,
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

  const scheduler = new EngineScheduler(
    eventBus,
    () => store.getAllShips().map((ship) => ship.id),
  );

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
  const server = startHttpServer({
    engine: app.engine,
    eventBus: app.eventBus,
    store: app.store,
    getHealthCheck: app.getHealthCheck,
    completeTaskAction: app.completeTaskAction,
  });

  logger.stateChange({
    eventType: "SYSTEM_STARTUP",
    status: "RUNNING",
    result: `tasks=${health.totalTasks},overdue=${health.overdueTasks},lastPersisted=${health.lastPersistenceTimestamp ?? "none"}`,
  });

  app.scheduler.start();

  const gracefulShutdown = (signal: "SIGINT" | "SIGTERM") => {
    try {
      logger.stateChange({
        eventType: signal,
        status: "SHUTTING_DOWN",
      });
      server.close();
      app.shutdown();
      logger.stateChange({
        eventType: signal,
        status: "STOPPED",
      });
      process.exit(0);
    } catch (error) {
      logger.error("graceful_shutdown_failed", error, {
        eventType: signal,
        status: "FAILED",
      });
      process.exit(1);
    }
  };

  process.once("SIGINT", () => gracefulShutdown("SIGINT"));
  process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
}
