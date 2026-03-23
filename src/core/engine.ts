import { EscalateCoAction } from "../actions/escalate-co.action";
import { CheckTaskAction } from "../actions/check-task.action";
import { CreatePmsTaskAction } from "../actions/create-pms-task.action";
import { CreateDefectTaskAction } from "../actions/create-defect-task.action";
import { MarkComplianceAction } from "../actions/mark-compliance.action";
import { MarkPmsTaskOverdueAction } from "../actions/mark-pms-task-overdue.action";
import { EscalateDefectToLogComdAction } from "../actions/escalate-defect-to-log-comd.action";
import { EscalateDefectToMccAction } from "../actions/escalate-defect-to-mcc.action";
import { NotifyMeoAction } from "../actions/notify-meo.action";
import { NotifyPmsSupervisorAction } from "../actions/notify-pms-supervisor.action";
import { ReplanPmsTaskAction } from "../actions/replan-pms-task.action";
import { ActionCommand, EngineEvent } from "./types";
import { config } from "./config";
import { logger } from "./logger";
import { InMemoryStore } from "./store";
import { DailyLogRule } from "../rules/daily-log.rule";
import { DefectRule } from "../rules/defect.rule";
import { PmsTaskRule } from "../rules/pms-task.rule";
import { EventBus } from "../events/event-system";

interface EngineDependencies {
  store: InMemoryStore;
  dailyLogRule: DailyLogRule;
  pmsTaskRule: PmsTaskRule;
  defectRule: DefectRule;
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

  private isDuplicateEvent(event: EngineEvent): boolean {
    const eventKey = JSON.stringify(event);
    const now = Date.now();
    const isDuplicate =
      this.lastEventKey === eventKey &&
      now - this.lastEventAtMs < config.eventDebounceWindowMs;

    this.lastEventKey = eventKey;
    this.lastEventAtMs = now;

    return isDuplicate;
  }
}
