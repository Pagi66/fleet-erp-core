import cron, { ScheduledTask } from "node-cron";
import { AssignedRoleId, TaskSeverity } from "../core/types";
import {
  createDailyLogCheckDueEvent,
  createDailyLogEscalationDueEvent,
} from "./log-events";
import { EventBus } from "./event-system";
import {
  createDefectEvaluationEvent,
  createDefectReportedEvent,
} from "./defect-events";
import { createPmsTaskCheckEvent, createPmsTaskGenerateEvent } from "./pms-events";

export class EngineScheduler {
  private readonly tasks: ScheduledTask[] = [];

  constructor(private readonly eventBus: EventBus) {}

  start(): void {
    this.tasks.push(
      cron.schedule("59 23 * * *", () => {
        const now = new Date();
        const businessDate = formatDate(now);
        this.eventBus.emit(
          {
            ...createDailyLogCheckDueEvent(businessDate, now.toISOString()),
            actor: "SYSTEM",
          },
        );
      }),
    );

    this.tasks.push(
      cron.schedule("0 8 * * *", () => {
        const now = new Date();
        const businessDate = formatDate(previousDay(now));
        this.eventBus.emit(
          {
            ...createDailyLogEscalationDueEvent(businessDate, now.toISOString()),
            actor: "SYSTEM",
          },
        );
      }),
    );
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
      task.destroy();
    }
    this.tasks.length = 0;
  }

  triggerEndOfDayCheck(businessDate: string, occurredAt?: string): void {
    this.eventBus.emit(
      {
        ...createDailyLogCheckDueEvent(
          businessDate,
          occurredAt ?? new Date().toISOString(),
        ),
        actor: "SYSTEM",
      },
    );
  }

  triggerMorningEscalation(businessDate: string, occurredAt?: string): void {
    this.eventBus.emit(
      {
        ...createDailyLogEscalationDueEvent(
          businessDate,
          occurredAt ?? new Date().toISOString(),
        ),
        actor: "SYSTEM",
      },
    );
  }

  triggerPmsTaskGenerate(
    shipId: string,
    taskId: string,
    taskTitle: string,
    businessDate: string,
    dueDate: string,
    assignedRole: AssignedRoleId,
    occurredAt?: string,
  ): void {
    this.eventBus.emit(
      {
        ...createPmsTaskGenerateEvent(
          shipId,
          taskId,
          taskTitle,
          businessDate,
          dueDate,
          assignedRole,
          occurredAt ?? new Date().toISOString(),
        ),
        actor: "SYSTEM",
      },
    );
  }

  triggerPmsTaskCheck(
    shipId: string,
    taskId: string,
    businessDate: string,
    occurredAt?: string,
  ): void {
    this.eventBus.emit(
      {
        ...createPmsTaskCheckEvent(
          shipId,
          taskId,
          businessDate,
          occurredAt ?? new Date().toISOString(),
        ),
        actor: "SYSTEM",
      },
    );
  }

  triggerDefectReported(
    shipId: string,
    taskId: string,
    taskTitle: string,
    businessDate: string,
    ettrDays: number,
    severity: TaskSeverity,
    occurredAt?: string,
  ): void {
    this.eventBus.emit(
      {
        ...createDefectReportedEvent(
          shipId,
          taskId,
          taskTitle,
          businessDate,
          ettrDays,
          severity,
          occurredAt ?? new Date().toISOString(),
        ),
        actor: "SYSTEM",
      },
    );
  }

  triggerDefectEvaluation(
    shipId: string,
    taskId: string,
    businessDate: string,
    occurredAt?: string,
  ): void {
    this.eventBus.emit(
      {
        ...createDefectEvaluationEvent(
          shipId,
          taskId,
          businessDate,
          occurredAt ?? new Date().toISOString(),
        ),
        actor: "SYSTEM",
      },
    );
  }
}

function previousDay(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - 1);
  return result;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
