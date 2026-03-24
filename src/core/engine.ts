import { AuditApprovalInvalidAttemptAction } from "../actions/audit-approval-invalid-attempt.action";
import { ApproveApprovalRecordAction } from "../actions/approve-approval-record.action";
import { CreateApprovalRecordAction } from "../actions/create-approval-record.action";
import { EscalateCoAction } from "../actions/escalate-co.action";
import { CheckTaskAction } from "../actions/check-task.action";
import { CreatePmsTaskAction } from "../actions/create-pms-task.action";
import { CreateDefectTaskAction } from "../actions/create-defect-task.action";
import { MarkComplianceAction } from "../actions/mark-compliance.action";
import { MarkPmsTaskOverdueAction } from "../actions/mark-pms-task-overdue.action";
import { EscalateDefectToLogComdAction } from "../actions/escalate-defect-to-log-comd.action";
import { EscalateDefectToMccAction } from "../actions/escalate-defect-to-mcc.action";
import { NotifyMeoAction } from "../actions/notify-meo.action";
import { NotifyApprovalOwnerAction } from "../actions/notify-approval-owner.action";
import { NotifyPmsSupervisorAction } from "../actions/notify-pms-supervisor.action";
import { RejectApprovalRecordAction } from "../actions/reject-approval-record.action";
import { ReplanPmsTaskAction } from "../actions/replan-pms-task.action";
import { SubmitApprovalRecordAction } from "../actions/submit-approval-record.action";
import { ActionCommand, EngineEvent } from "./types";
import { config } from "./config";
import { logger } from "./logger";
import { InMemoryStore } from "./store";
import { ApprovalRule } from "../rules/approval.rule";
import { DailyLogRule } from "../rules/daily-log.rule";
import { DefectRule } from "../rules/defect.rule";
import { PmsTaskRule } from "../rules/pms-task.rule";
import { EventBus } from "../events/event-system";

interface EngineDependencies {
  store: InMemoryStore;
  approvalRule: ApprovalRule;
  dailyLogRule: DailyLogRule;
  pmsTaskRule: PmsTaskRule;
  defectRule: DefectRule;
  auditApprovalInvalidAttemptAction: AuditApprovalInvalidAttemptAction;
  createApprovalRecordAction: CreateApprovalRecordAction;
  submitApprovalRecordAction: SubmitApprovalRecordAction;
  approveApprovalRecordAction: ApproveApprovalRecordAction;
  rejectApprovalRecordAction: RejectApprovalRecordAction;
  notifyApprovalOwnerAction: NotifyApprovalOwnerAction;
  markComplianceAction: MarkComplianceAction;
  notifyMeoAction: NotifyMeoAction;
  escalateCoAction: EscalateCoAction;
  checkTaskAction: CheckTaskAction;
  createPmsTaskAction: CreatePmsTaskAction;
  createDefectTaskAction: CreateDefectTaskAction;
  markPmsTaskOverdueAction: MarkPmsTaskOverdueAction;
  replanPmsTaskAction: ReplanPmsTaskAction;
  notifyPmsSupervisorAction: NotifyPmsSupervisorAction;
  escalateDefectToMccAction: EscalateDefectToMccAction;
  escalateDefectToLogComdAction: EscalateDefectToLogComdAction;
  eventBus: EventBus;
}

export class ComplianceEngine {
  private readonly unsubscribe: () => void;

  private lastEventKey: string | null = null;

  private lastEventAtMs = 0;

  constructor(private readonly dependencies: EngineDependencies) {
    this.unsubscribe = this.dependencies.eventBus.subscribe((event) => {
      this.routeEvent(event);
    });
  }

  routeEvent(event: EngineEvent): void {
    this.assertEventContext(event);

    if (this.isDuplicateEvent(event)) {
      logger.warn("duplicate_event_skipped", {
        eventType: event.type,
        ...(event.taskId ? { taskId: event.taskId } : {}),
        status: "SKIPPED",
      });
      return;
    }

    logger.eventReceived({
      eventType: event.type,
      ...(event.taskId ? { taskId: event.taskId } : {}),
    });

    try {
      const decision = this.evaluate(event);
      logger.ruleDecision({
        eventType: event.type,
        ...(event.taskId ? { taskId: event.taskId } : {}),
        result: decision.result,
        status: decision.result,
      });

      for (const command of decision.commands) {
        this.assertCommandContext(command, event);
        this.dispatch(
          {
            ...command,
            actor: command.actor ?? event.actor ?? "SYSTEM",
          },
          event.type,
        );
      }
    } catch (error) {
      logger.error("event_handling_failed", error, {
        eventType: event.type,
        ...(event.taskId ? { taskId: event.taskId } : {}),
      });
      throw error;
    }
  }

  stop(): void {
    this.unsubscribe();
  }

  private dispatch(command: ActionCommand, eventType: EngineEvent["type"]): void {
    try {
      logger.actionExecution({
        eventType,
        ...(command.taskId ? { taskId: command.taskId } : {}),
        actionType: command.type,
        status: "STARTED",
      });

      let executed = false;
      switch (command.type) {
      case "MARK_COMPLIANT":
      case "MARK_NON_COMPLIANT":
        this.dependencies.markComplianceAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "NOTIFY_MEO":
        this.dependencies.notifyMeoAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "ESCALATE_TO_CO":
        this.dependencies.escalateCoAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "CHECK_TASK":
        this.dependencies.checkTaskAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "CREATE_PMS_TASK":
        this.dependencies.createPmsTaskAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "CREATE_DEFECT_TASK":
        this.dependencies.createDefectTaskAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "MARK_PMS_TASK_OVERDUE":
        this.dependencies.markPmsTaskOverdueAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "REPLAN_PMS_TASK":
        this.dependencies.replanPmsTaskAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "NOTIFY_PMS_SUPERVISOR":
        this.dependencies.notifyPmsSupervisorAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "ESCALATE_DEFECT_TO_MCC":
        this.dependencies.escalateDefectToMccAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "ESCALATE_DEFECT_TO_LOG_COMD":
        this.dependencies.escalateDefectToLogComdAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "AUDIT_APPROVAL_INVALID_ATTEMPT":
        this.dependencies.auditApprovalInvalidAttemptAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "CREATE_APPROVAL_RECORD":
        this.dependencies.createApprovalRecordAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "SUBMIT_APPROVAL_RECORD":
        this.dependencies.submitApprovalRecordAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "APPROVE_APPROVAL_RECORD":
        this.dependencies.approveApprovalRecordAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "REJECT_APPROVAL_RECORD":
        this.dependencies.rejectApprovalRecordAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      case "NOTIFY_APPROVAL_OWNER":
        this.dependencies.notifyApprovalOwnerAction.execute(
          command,
          this.dependencies.store,
        );
        executed = true;
        break;
      default: {
        const exhaustiveCheck: never = command.type;
        throw new Error(`Unsupported action command: ${exhaustiveCheck}`);
      }
      }

      if (executed) {
        logger.actionExecution({
          eventType,
          ...(command.taskId ? { taskId: command.taskId } : {}),
          actionType: command.type,
          status: "COMPLETED",
          result: "OK",
        });
      }
    } catch (error) {
      logger.error("action_execution_failed", error, {
        eventType,
        ...(command.taskId ? { taskId: command.taskId } : {}),
        actionType: command.type,
      });
    }
  }

  private evaluate(event: EngineEvent) {
    try {
      switch (event.type) {
        case "DAILY_LOG_CHECK_DUE":
        case "DAILY_LOG_ESCALATION_DUE":
          return this.dependencies.dailyLogRule.evaluate(
            event,
            this.dependencies.store,
          );
        case "PMS_TASK_GENERATE":
        case "PMS_TASK_CHECK":
          return this.dependencies.pmsTaskRule.evaluate(
            event,
            this.dependencies.store,
          );
        case "DEFECT_REPORTED":
        case "DEFECT_EVALUATION":
          return this.dependencies.defectRule.evaluate(
            event,
            this.dependencies.store,
          );
        case "APPROVAL_RECORD_CREATE":
        case "APPROVAL_RECORD_SUBMIT":
        case "APPROVAL_RECORD_APPROVE":
        case "APPROVAL_RECORD_REJECT":
        case "APPROVAL_RECORD_STALE_CHECK":
          return this.dependencies.approvalRule.evaluate(
            event,
            this.dependencies.store,
          );
        default: {
          const exhaustiveCheck: never = event.type;
          throw new Error(`Unsupported engine event: ${exhaustiveCheck}`);
        }
      }
    } catch (error) {
      logger.error("rule_evaluation_failed", error, {
        eventType: event.type,
        ...(event.taskId ? { taskId: event.taskId } : {}),
      });
      throw error;
    }
  }

  private assertEventContext(event: EngineEvent): void {
    const validationError = this.getEventValidationError(event);
    if (!validationError) {
      return;
    }

    logger.error("event_context_validation_failed", new Error(validationError), {
      eventType: event.type,
      ...(event.taskId ? { taskId: event.taskId } : {}),
      status: validationError,
    });
    throw new Error(validationError);
  }

  private getEventValidationError(event: EngineEvent): string | null {
    switch (event.type) {
      case "DAILY_LOG_CHECK_DUE":
      case "DAILY_LOG_ESCALATION_DUE":
        return !event.shipId ? `${event.type} requires shipId` : null;
      case "PMS_TASK_GENERATE":
        return !event.shipId
          ? "PMS_TASK_GENERATE requires shipId"
          : !event.taskId
            ? "PMS_TASK_GENERATE requires taskId"
            : !event.taskTitle
              ? "PMS_TASK_GENERATE requires taskTitle"
              : !event.dueDate
                ? "PMS_TASK_GENERATE requires dueDate"
                : !event.assignedRole
                  ? "PMS_TASK_GENERATE requires assignedRole"
                  : null;
      case "PMS_TASK_CHECK":
        return !event.shipId
          ? "PMS_TASK_CHECK requires shipId"
          : !event.taskId
            ? "PMS_TASK_CHECK requires taskId"
            : null;
      case "DEFECT_REPORTED":
        return !event.shipId
          ? "DEFECT_REPORTED requires shipId"
          : !event.taskId
            ? "DEFECT_REPORTED requires taskId"
            : !event.taskTitle
              ? "DEFECT_REPORTED requires taskTitle"
              : null;
      case "DEFECT_EVALUATION":
        return !event.shipId
          ? "DEFECT_EVALUATION requires shipId"
          : !event.taskId
            ? "DEFECT_EVALUATION requires taskId"
            : null;
      case "APPROVAL_RECORD_CREATE":
        return !event.shipId
          ? "APPROVAL_RECORD_CREATE requires shipId"
          : !event.recordId
            ? "APPROVAL_RECORD_CREATE requires recordId"
            : !event.recordKind
              ? "APPROVAL_RECORD_CREATE requires recordKind"
              : !event.recordTitle
                ? "APPROVAL_RECORD_CREATE requires recordTitle"
                : !event.actor
                  ? "APPROVAL_RECORD_CREATE requires actor"
                  : null;
      case "APPROVAL_RECORD_SUBMIT":
      case "APPROVAL_RECORD_APPROVE":
      case "APPROVAL_RECORD_REJECT":
        return !event.shipId
          ? `${event.type} requires shipId`
          : !event.recordId
            ? `${event.type} requires recordId`
            : !event.actor
              ? `${event.type} requires actor`
              : null;
      case "APPROVAL_RECORD_STALE_CHECK":
        return !event.shipId ? "APPROVAL_RECORD_STALE_CHECK requires shipId" : null;
      default:
        return null;
    }
  }

  private assertCommandContext(command: ActionCommand, event: EngineEvent): void {
    if (!event.shipId) {
      return;
    }
    if (command.shipId && command.shipId !== event.shipId) {
      logger.error("command_context_validation_failed", new Error("Command shipId mismatch"), {
        eventType: event.type,
        ...(command.taskId ? { taskId: command.taskId } : {}),
        actionType: command.type,
        status: `${event.shipId}->${command.shipId}`,
      });
      throw new Error(`Command ${command.type} shipId mismatch`);
    }
    if (!command.shipId && command.taskId) {
      logger.error("command_context_validation_failed", new Error("Command missing shipId"), {
        eventType: event.type,
        ...(command.taskId ? { taskId: command.taskId } : {}),
        actionType: command.type,
        status: "MISSING_SHIP_ID",
      });
      throw new Error(`Command ${command.type} requires shipId`);
    }
  }

  private isDuplicateEvent(event: EngineEvent): boolean {
    const eventKey = JSON.stringify({
      type: event.type,
      shipId: event.shipId ?? "GLOBAL",
      taskId: event.taskId ?? null,
      recordId: event.recordId ?? null,
      businessDate: event.businessDate,
      occurredAt: event.occurredAt,
      transitionId: event.transitionId ?? null,
    });
    const now = Date.now();
    const isDuplicate =
      this.lastEventKey === eventKey &&
      now - this.lastEventAtMs < config.eventDebounceWindowMs;

    this.lastEventKey = eventKey;
    this.lastEventAtMs = now;

    return isDuplicate;
  }
}
