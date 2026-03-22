import { InMemoryStore } from "../core/store";
import { ActionCommand, EngineEvent, RuleDecision } from "../core/types";

export class DefectRule {
  evaluate(event: EngineEvent, store: InMemoryStore): RuleDecision {
    if (event.type === "DEFECT_REPORTED") {
      if (!event.taskId || !event.taskTitle) {
        throw new Error("DEFECT_REPORTED event is missing task fields");
      }

      const existingTask = store.getTask(event.taskId);
      if (existingTask) {
        return this.createDecision(event, "NO_CHANGE", []);
      }

      const commands: ActionCommand[] = [
        {
          type: "CREATE_DEFECT_TASK",
          businessDate: event.businessDate,
          issuedAt: event.occurredAt,
          missingLogs: [],
          taskId: event.taskId,
          taskTitle: event.taskTitle,
          taskKind: "DEFECT",
          assignedRole: "MEO",
          ...(typeof event.ettrDays === "number" ? { ettrDays: event.ettrDays } : {}),
          ...(typeof event.severity !== "undefined"
            ? { severity: event.severity }
            : {}),
        },
      ];

      if (event.severity === "CRITICAL") {
        commands.push({
          type: "ESCALATE_DEFECT_TO_MCC",
          businessDate: event.businessDate,
          issuedAt: event.occurredAt,
          missingLogs: [],
          taskId: event.taskId,
          targetRole: "MCC",
        });
      }

      return this.createDecision(event, "TASK_CREATED", commands);
    }

    if (!event.taskId) {
      throw new Error("DEFECT_EVALUATION event is missing taskId");
    }

    const snapshot = store.getTaskSnapshot(event.taskId);
    if (!snapshot.task) {
      return this.createDecision(event, "NO_CHANGE", []);
    }

    if (snapshot.task.status === "COMPLETED") {
      return this.createDecision(event, "TASK_COMPLETED", [
        {
          type: "CHECK_TASK",
          businessDate: event.businessDate,
          issuedAt: event.occurredAt,
          missingLogs: [],
          taskId: snapshot.task.id,
        },
      ]);
    }

    if (snapshot.task.severity === "CRITICAL") {
      if (snapshot.task.escalationLevel === "LOG_COMD") {
        return this.createDecision(event, "NO_CHANGE", [
          {
            type: "CHECK_TASK",
            businessDate: event.businessDate,
            issuedAt: event.occurredAt,
            missingLogs: [],
            taskId: snapshot.task.id,
          },
        ]);
      }

      const actionType =
        snapshot.task.escalationLevel === "MCC"
          ? "ESCALATE_DEFECT_TO_LOG_COMD"
          : "ESCALATE_DEFECT_TO_MCC";

      return this.createDecision(event, "TASK_ESCALATED", [
        {
          type: "CHECK_TASK",
          businessDate: event.businessDate,
          issuedAt: event.occurredAt,
          missingLogs: [],
          taskId: snapshot.task.id,
        },
        {
          type: actionType,
          businessDate: event.businessDate,
          issuedAt: event.occurredAt,
          missingLogs: [],
          taskId: snapshot.task.id,
          targetRole: actionType === "ESCALATE_DEFECT_TO_MCC" ? "MCC" : "LOG_COMD",
        },
      ]);
    }

    if ((snapshot.task.ettrDays ?? 0) > 21) {
      if (snapshot.task.escalationLevel === "LOG_COMD") {
        return this.createDecision(event, "NO_CHANGE", [
          {
            type: "CHECK_TASK",
            businessDate: event.businessDate,
            issuedAt: event.occurredAt,
            missingLogs: [],
            taskId: snapshot.task.id,
          },
        ]);
      }

      return this.createDecision(event, "TASK_ESCALATED", [
        {
          type: "CHECK_TASK",
          businessDate: event.businessDate,
          issuedAt: event.occurredAt,
          missingLogs: [],
          taskId: snapshot.task.id,
        },
        {
          type: "ESCALATE_DEFECT_TO_LOG_COMD",
          businessDate: event.businessDate,
          issuedAt: event.occurredAt,
          missingLogs: [],
          taskId: snapshot.task.id,
          targetRole: "LOG_COMD",
        },
      ]);
    }

    return this.createDecision(event, "NO_CHANGE", [
      {
        type: "CHECK_TASK",
        businessDate: event.businessDate,
        issuedAt: event.occurredAt,
        missingLogs: [],
        taskId: snapshot.task.id,
      },
    ]);
  }

  private createDecision(
    event: EngineEvent,
    result: RuleDecision["result"],
    commands: ActionCommand[],
  ): RuleDecision {
    return {
      eventType: event.type,
      businessDate: event.businessDate,
      result,
      missingLogs: [],
      commands,
    };
  }
}
