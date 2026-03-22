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

  constructor(private readonly dependencies: EngineDependencies) {
    this.unsubscribe = this.dependencies.eventBus.subscribe((event) => {
      this.routeEvent(event);
    });
  }

  routeEvent(event: EngineEvent): void {
    const decision = this.evaluate(event);

    for (const command of decision.commands) {
      this.dispatch(command);
    }
  }

  stop(): void {
    this.unsubscribe();
  }

  private dispatch(command: ActionCommand): void {
    switch (command.type) {
      case "MARK_COMPLIANT":
      case "MARK_NON_COMPLIANT":
        this.dependencies.markComplianceAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "NOTIFY_MEO":
        this.dependencies.notifyMeoAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "ESCALATE_TO_CO":
        this.dependencies.escalateCoAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "CHECK_TASK":
        this.dependencies.checkTaskAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "CREATE_PMS_TASK":
        this.dependencies.createPmsTaskAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "CREATE_DEFECT_TASK":
        this.dependencies.createDefectTaskAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "MARK_PMS_TASK_OVERDUE":
        this.dependencies.markPmsTaskOverdueAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "REPLAN_PMS_TASK":
        this.dependencies.replanPmsTaskAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "NOTIFY_PMS_SUPERVISOR":
        this.dependencies.notifyPmsSupervisorAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "ESCALATE_DEFECT_TO_MCC":
        this.dependencies.escalateDefectToMccAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      case "ESCALATE_DEFECT_TO_LOG_COMD":
        this.dependencies.escalateDefectToLogComdAction.execute(
          command,
          this.dependencies.store,
        );
        return;
      default: {
        const exhaustiveCheck: never = command.type;
        throw new Error(`Unsupported action command: ${exhaustiveCheck}`);
      }
    }
  }

  private evaluate(event: EngineEvent) {
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
  }
}
