import { EscalateCoAction } from "./actions/escalate-co.action";
import { CheckTaskAction } from "./actions/check-task.action";
import { CreateDefectTaskAction } from "./actions/create-defect-task.action";
import { CreatePmsTaskAction } from "./actions/create-pms-task.action";
import { EscalateDefectToLogComdAction } from "./actions/escalate-defect-to-log-comd.action";
import { EscalateDefectToMccAction } from "./actions/escalate-defect-to-mcc.action";
import { MarkComplianceAction } from "./actions/mark-compliance.action";
import { MarkPmsTaskOverdueAction } from "./actions/mark-pms-task-overdue.action";
import { NotifyMeoAction } from "./actions/notify-meo.action";
import { NotifyPmsSupervisorAction } from "./actions/notify-pms-supervisor.action";
import { ReplanPmsTaskAction } from "./actions/replan-pms-task.action";
import { ComplianceEngine } from "./core/engine";
import { InMemoryStore } from "./core/store";
import { EventBus } from "./events/event-system";
import { EngineScheduler } from "./events/scheduler";
import { DailyLogRule } from "./rules/daily-log.rule";
import { DefectRule } from "./rules/defect.rule";
import { PmsTaskRule } from "./rules/pms-task.rule";

export function createDailyLogEngineApp() {
  const store = new InMemoryStore();
  const dailyLogRule = new DailyLogRule();
  const pmsTaskRule = new PmsTaskRule();
  const defectRule = new DefectRule();
  const eventBus = new EventBus();
  const markComplianceAction = new MarkComplianceAction();
  const notifyMeoAction = new NotifyMeoAction();
  const escalateCoAction = new EscalateCoAction();
  const checkTaskAction = new CheckTaskAction();
  const createPmsTaskAction = new CreatePmsTaskAction();
  const createDefectTaskAction = new CreateDefectTaskAction();
  const markPmsTaskOverdueAction = new MarkPmsTaskOverdueAction();
  const replanPmsTaskAction = new ReplanPmsTaskAction();
  const notifyPmsSupervisorAction = new NotifyPmsSupervisorAction();
  const escalateDefectToMccAction = new EscalateDefectToMccAction();
  const escalateDefectToLogComdAction = new EscalateDefectToLogComdAction();

  const engine = new ComplianceEngine({
    store,
    dailyLogRule,
    pmsTaskRule,
    defectRule,
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

  const scheduler = new EngineScheduler(eventBus);

  return {
    store,
    engine,
    eventBus,
    scheduler,
  };
}

if (require.main === module) {
  const app = createDailyLogEngineApp();
  app.scheduler.start();
}
