import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";
import { config } from "./config";
import { logger } from "./logger";
import {
  AssignedRoleId,
  DailyComplianceState,
  EscalationState,
  LogRecord,
  LogType,
  Notification,
  REQUIRED_DAILY_LOGS,
  RoleId,
  Ship,
  StoreSnapshot,
  Task,
  TaskHistoryEntry,
  TaskHistoryType,
  TaskSnapshot,
  TaskStateSnapshot,
} from "./types";

const STORE_STATE_VERSION = 5;

interface PersistedStoreState {
  version: number;
  ships: Ship[];
  tasks: Task[];
  taskHistory: Array<[string, TaskHistoryEntry[]]>;
  escalationState: Array<[string, EscalationState]>;
  notifications: Notification[];
}

export interface StoreHealthCheck {
  running: boolean;
  totalTasks: number;
  overdueTasks: number;
  escalationCounts: {
    none: number;
    mcc: number;
    logComd: number;
  };
  perShip: Record<string, {
    totalTasks: number;
    overdueTasks: number;
    escalationCounts: {
      none: number;
      mcc: number;
      logComd: number;
    };
  }>;
  lastPersistenceTimestamp: string | null;
}

export class InMemoryStore {
  private readonly shipsById = new Map<string, Ship>();

  private readonly logsByDate = new Map<string, LogRecord[]>();

  private readonly complianceByDate = new Map<string, DailyComplianceState>();

  private readonly escalationByDate = new Map<string, EscalationState>();

  private readonly tasksById = new Map<string, Task>();

  private readonly taskHistoryById = new Map<string, TaskHistoryEntry[]>();

  private readonly notificationsById = new Map<string, Notification>();

  private readonly persistenceFilePath: string;

  private readonly backupFilePath: string;

  private readonly tempFilePath: string;

  private lastPersistenceTimestamp: string | null = null;

  constructor(persistenceFilePath = config.persistenceFilePath) {
    this.persistenceFilePath = persistenceFilePath;
    this.backupFilePath = `${persistenceFilePath}.bak`;
    this.tempFilePath = `${persistenceFilePath}.tmp`;
    this.loadPersistedState();
  }

  saveLog(record: LogRecord): void {
    this.assertValidShipId(record.shipId);
    this.assertShipExists(record.shipId);
    const stateKey = this.getDailyStateKey(record.shipId, record.businessDate);
    const existing = this.logsByDate.get(stateKey) ?? [];
    const withoutSameType = existing.filter(
      (entry) => entry.logType !== record.logType,
    );
    withoutSameType.push(record);
    this.logsByDate.set(stateKey, withoutSameType);
    logger.stateChange({
      eventType: "LOG_RECORDED",
      status: "UPDATED",
    });
  }

  getLogsForDate(shipId: string, businessDate: string): LogRecord[] {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    return [...(this.logsByDate.get(stateKey) ?? [])];
  }

  getOrCreateComplianceState(
    shipId: string,
    businessDate: string,
  ): DailyComplianceState {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    const existing = this.complianceByDate.get(stateKey);
    if (existing) {
      return existing;
    }

    const initialState: DailyComplianceState = {
      shipId,
      businessDate,
      requiredLogs: [...REQUIRED_DAILY_LOGS],
      presentLogs: [],
      missingLogs: [...REQUIRED_DAILY_LOGS],
      status: "PENDING",
      lastEvaluatedAt: null,
      meoNotifiedAt: null,
    };

    this.complianceByDate.set(stateKey, initialState);
    return initialState;
  }

  updateComplianceState(
    shipId: string,
    businessDate: string,
    update: Partial<DailyComplianceState>,
  ): DailyComplianceState {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    const current = this.getOrCreateComplianceState(shipId, businessDate);
    const next: DailyComplianceState = {
      ...current,
      ...update,
    };
    this.complianceByDate.set(stateKey, next);
    logger.stateChange({
      eventType: "COMPLIANCE_STATE_UPDATED",
      status: next.status,
    });
    return next;
  }

  getOrCreateEscalationState(shipId: string, businessDate: string): EscalationState {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    const existing = this.escalationByDate.get(stateKey);
    if (existing) {
      return existing;
    }

    const initialState: EscalationState = {
      shipId,
      businessDate,
      status: "NOT_ESCALATED",
      reason: null,
      missingLogsAtEscalation: [],
      escalatedAt: null,
      targetRole: null,
    };

    this.escalationByDate.set(stateKey, initialState);
    return initialState;
  }

  updateEscalationState(
    shipId: string,
    businessDate: string,
    update: Partial<EscalationState>,
  ): EscalationState {
    const stateKey = this.getDailyStateKey(shipId, businessDate);
    const current = this.getOrCreateEscalationState(shipId, businessDate);
    const next: EscalationState = {
      ...current,
      ...update,
    };
    this.escalationByDate.set(stateKey, next);
    logger.stateChange({
      eventType: "ESCALATION_STATE_UPDATED",
      status: next.status,
    });
    this.persistState();
    return next;
  }

  getSnapshot(shipId: string, businessDate: string): StoreSnapshot {
    return {
      logs: this.getLogsForDate(shipId, businessDate),
      complianceState: this.getOrCreateComplianceState(shipId, businessDate),
      escalationState: this.getOrCreateEscalationState(shipId, businessDate),
    };
  }

  createTask(task: Task, occurredAt: string, actor: RoleId): Task {
    this.assertValidShipId(task.shipId);
    this.assertShipExists(task.shipId);
    this.assertValidAssignedRole(task.assignedRole, "assignedRole");
    this.assertValidRole(actor, "actor");
    const existing = this.getTask(task.id);
    if (existing) {
      if (existing.shipId !== task.shipId) {
        logger.error("cross_ship_task_id_conflict", new Error("Task ID already used by another ship"), {
          taskId: task.id,
          status: `${existing.shipId}->${task.shipId}`,
        });
        throw new Error(`Task ID already exists in another ship: ${task.id}`);
      }
      return existing;
    }

    this.tasksById.set(task.id, task);
    const state = this.createStateSnapshot(task);
    this.appendTaskHistory(
      task.id,
      task.shipId,
      "CREATED",
      state,
      state,
      occurredAt,
      actor,
    );
    logger.stateChange({
      taskId: task.id,
      actionType: "CREATED",
      status: task.status,
    });
    this.persistState();
    return task;
  }

  getTask(taskId: string): Task | null {
    return this.tasksById.get(taskId) ?? null;
  }

  getTaskInShip(taskId: string, shipId: string): Task | null {
    this.assertValidShipId(shipId);
    const task = this.getTask(taskId);
    if (!task || task.shipId !== shipId) {
      return null;
    }
    return task;
  }

  completeTask(taskId: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.status === "COMPLETED") {
      return current;
    }

    this.assertTaskStatusTransition(current.status, "COMPLETED");
    return this.applyTaskUpdate(
      taskId,
      {
        status: "COMPLETED",
        completedAt: occurredAt,
        lastCheckedAt: occurredAt,
      },
      "COMPLETED",
      occurredAt,
      actor,
    );
  }

  recordTaskCheck(taskId: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.lastCheckedAt === occurredAt) {
      return current;
    }

    return this.applyTaskUpdate(
      taskId,
      {
        lastCheckedAt: occurredAt,
      },
      "CHECKED",
      occurredAt,
      actor,
    );
  }

  markTaskOverdue(taskId: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.status === "COMPLETED" || current.status === "OVERDUE") {
      return current;
    }

    this.assertTaskStatusTransition(current.status, "OVERDUE");
    return this.applyTaskUpdate(
      taskId,
      {
        status: "OVERDUE",
        lastCheckedAt: occurredAt,
        lastOverdueAt: occurredAt,
      },
      "STATUS_CHANGED",
      occurredAt,
      actor,
    );
  }

  escalateTask(
    taskId: string,
    escalationLevel: "MCC" | "LOG_COMD",
    occurredAt: string,
    actor: RoleId,
  ): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.escalationLevel === escalationLevel) {
      return current;
    }

    this.assertEscalationTransition(current.escalationLevel, escalationLevel);
    return this.applyTaskUpdate(
      taskId,
      {
        escalationLevel,
        escalatedAt: occurredAt,
        lastNotifiedAt: occurredAt,
      },
      "ESCALATED",
      occurredAt,
      actor,
    );
  }

  replanTask(taskId: string, nextDueDate: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (current.dueDate === nextDueDate) {
      return current;
    }

    return this.applyTaskUpdate(
      taskId,
      {
        dueDate: nextDueDate,
        parentTaskId: current.parentTaskId ?? current.id,
        replannedFromDueDate: current.dueDate,
        replannedToDueDate: nextDueDate,
      },
      "REPLANNED",
      occurredAt,
      actor,
    );
  }

  recordTaskNotification(taskId: string, occurredAt: string, actor: RoleId): Task {
    this.assertValidRole(actor, "actor");
    const current = this.requireTask(taskId);
    if (
      current.lastNotifiedAt !== null &&
      (current.lastOverdueAt === null || current.lastNotifiedAt >= current.lastOverdueAt)
    ) {
      return current;
    }

    return this.applyTaskUpdate(
      taskId,
      {
        lastNotifiedAt: occurredAt,
      },
      "NOTIFIED",
      occurredAt,
      actor,
    );
  }

  getTaskSnapshot(taskId: string): TaskSnapshot {
    return {
      task: this.getTask(taskId),
      history: [...(this.taskHistoryById.get(taskId) ?? [])],
    };
  }

  getTaskSnapshotInShip(taskId: string, shipId: string): TaskSnapshot {
    const task = this.getTaskInShip(taskId, shipId);
    return {
      task,
      history: task ? [...(this.taskHistoryById.get(taskId) ?? [])] : [],
    };
  }

  getAllTasks(): Task[] {
    return [...this.tasksById.values()];
  }

  getTasksByShip(shipId: string): Task[] {
    this.assertValidShipId(shipId);
    return this.getAllTasks().filter((task) => task.shipId === shipId);
  }

  getOverdueTasks(): Task[] {
    return this.getAllTasks().filter((task) => task.status === "OVERDUE");
  }

  getOverdueTasksByShip(shipId: string): Task[] {
    this.assertValidShipId(shipId);
    return this.getOverdueTasks().filter((task) => task.shipId === shipId);
  }

  saveShip(ship: Ship): Ship {
    this.assertValidShip(ship);
    this.shipsById.set(ship.id, ship);
    this.persistState();
    return ship;
  }

  getShip(shipId: string): Ship | null {
    return this.shipsById.get(shipId) ?? null;
  }

  getAllShips(): Ship[] {
    return [...this.shipsById.values()];
  }

  createNotification(
    input: Omit<Notification, "id" | "read">,
  ): Notification {
    this.assertValidShipId(input.shipId);
    this.assertShipExists(input.shipId);
    this.assertValidRole(input.targetRole, "targetRole");
    const dedupeKey = this.buildNotificationDedupeKey(input);
    const existing = [...this.notificationsById.values()].find(
      (notification) => notification.dedupeKey === dedupeKey,
    );
    if (existing) {
      logger.warn("duplicate_notification_skipped", {
        ...(input.taskId ? { taskId: input.taskId } : {}),
        status: dedupeKey,
      });
      return existing;
    }

    const notification: Notification = {
      ...input,
      id: `notification_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dedupeKey,
      read: false,
    };

    this.notificationsById.set(notification.id, notification);
    this.persistState();
    return notification;
  }

  getNotifications(shipId: string, role: RoleId): Notification[] {
    this.assertValidShipId(shipId);
    this.assertValidRole(role, "role");
    return [...this.notificationsById.values()].filter(
      (notification) =>
        notification.shipId === shipId && notification.targetRole === role,
    );
  }

  markNotificationRead(notificationId: string): Notification {
    const notification = this.notificationsById.get(notificationId);
    if (!notification) {
      throw new Error(`Notification not found: ${notificationId}`);
    }
    if (notification.read) {
      return notification;
    }

    const next: Notification = {
      ...notification,
      read: true,
    };
    this.notificationsById.set(notificationId, next);
    this.persistState();
    return next;
  }

  flush(): void {
    this.persistState();
  }

  getHealthCheck(): StoreHealthCheck {
    const tasks = [...this.tasksById.values()];
    const perShip = Object.fromEntries(
      [...this.shipsById.keys()].map((shipId) => {
        const shipTasks = tasks.filter((task) => task.shipId === shipId);
        return [
          shipId,
          {
            totalTasks: shipTasks.length,
            overdueTasks: shipTasks.filter((task) => task.status === "OVERDUE").length,
            escalationCounts: {
              none: shipTasks.filter((task) => task.escalationLevel === "NONE").length,
              mcc: shipTasks.filter((task) => task.escalationLevel === "MCC").length,
              logComd: shipTasks.filter((task) => task.escalationLevel === "LOG_COMD").length,
            },
          },
        ];
      }),
    );

    return {
      running: true,
      totalTasks: tasks.length,
      overdueTasks: tasks.filter((task) => task.status === "OVERDUE").length,
      escalationCounts: {
        none: tasks.filter((task) => task.escalationLevel === "NONE").length,
        mcc: tasks.filter((task) => task.escalationLevel === "MCC").length,
        logComd: tasks.filter((task) => task.escalationLevel === "LOG_COMD").length,
      },
      perShip,
      lastPersistenceTimestamp: this.lastPersistenceTimestamp,
    };
  }

  seedDailyLogs(
    shipId: string,
    businessDate: string,
    logTypes: LogType[],
    submittedByRole: "MARINE_ENGINEERING_OFFICER" = "MARINE_ENGINEERING_OFFICER",
  ): void {
    const submittedAt = new Date().toISOString();
    for (const logType of logTypes) {
      this.saveLog({
        shipId,
        businessDate,
        logType,
        submittedAt,
        submittedByRole,
      });
    }
  }

  private requireTask(taskId: string): Task {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private getDailyStateKey(shipId: string, businessDate: string): string {
    this.assertValidShipId(shipId);
    return `${shipId}:${businessDate}`;
  }

  private appendTaskHistory(
    taskId: string,
    shipId: string,
    actionType: TaskHistoryType,
    previousState: TaskStateSnapshot,
    newState: TaskStateSnapshot,
    timestamp: string,
    actor: RoleId,
  ): void {
    const current = this.taskHistoryById.get(taskId) ?? [];
    current.push({
      taskId,
      shipId,
      timestamp,
      actionType,
      previousState,
      newState,
      actor,
    });
    this.taskHistoryById.set(taskId, current);
    logger.stateChange({
      taskId,
      actionType,
      status: newState.status,
      result: `${previousState.status}->${newState.status}`,
    });
  }

  private applyTaskUpdate(
    taskId: string,
    update: Partial<Task>,
    actionType: TaskHistoryType,
    occurredAt: string,
    actor: RoleId,
  ): Task {
    const current = this.requireTask(taskId);
    const previousState = this.createStateSnapshot(current);
    const next: Task = {
      ...current,
      ...update,
    };

    this.tasksById.set(taskId, next);

    const newState = this.createStateSnapshot(next);
    if (!this.isSameState(previousState, newState)) {
      this.appendTaskHistory(
        taskId,
        next.shipId,
        actionType,
        previousState,
        newState,
        occurredAt,
        actor,
      );
    }

    this.persistState();
    return next;
  }

  private createStateSnapshot(task: Task): TaskStateSnapshot {
    return {
      shipId: task.shipId,
      parentTaskId: task.parentTaskId,
      kind: task.kind,
      assignedRole: task.assignedRole,
      status: task.status,
      completedAt: task.completedAt,
      lastCheckedAt: task.lastCheckedAt,
      lastOverdueAt: task.lastOverdueAt,
      replannedFromDueDate: task.replannedFromDueDate,
      replannedToDueDate: task.replannedToDueDate,
      escalationLevel: task.escalationLevel,
      dueDate: task.dueDate,
      lastNotifiedAt: task.lastNotifiedAt,
      ettrDays: task.ettrDays,
      severity: task.severity,
      escalatedAt: task.escalatedAt,
    };
  }

  private isSameState(
    left: TaskStateSnapshot,
    right: TaskStateSnapshot,
  ): boolean {
    return (
      left.shipId === right.shipId &&
      left.parentTaskId === right.parentTaskId &&
      left.kind === right.kind &&
      left.assignedRole === right.assignedRole &&
      left.status === right.status &&
      left.completedAt === right.completedAt &&
      left.lastCheckedAt === right.lastCheckedAt &&
      left.lastOverdueAt === right.lastOverdueAt &&
      left.replannedFromDueDate === right.replannedFromDueDate &&
      left.replannedToDueDate === right.replannedToDueDate &&
      left.escalationLevel === right.escalationLevel &&
      left.dueDate === right.dueDate &&
      left.lastNotifiedAt === right.lastNotifiedAt &&
      left.ettrDays === right.ettrDays &&
      left.severity === right.severity &&
      left.escalatedAt === right.escalatedAt
    );
  }

  private assertTaskStatusTransition(
    current: Task["status"],
    next: Task["status"],
  ): void {
    if (current === next) {
      return;
    }

    const allowedTransitions: Record<Task["status"], Task["status"][]> = {
      PENDING: ["COMPLETED", "OVERDUE"],
      OVERDUE: ["COMPLETED"],
      COMPLETED: [],
    };

    if (!allowedTransitions[current].includes(next)) {
      throw new Error(`Invalid task status transition: ${current} -> ${next}`);
    }
  }

  private assertEscalationTransition(
    current: Task["escalationLevel"],
    next: Task["escalationLevel"],
  ): void {
    const allowedTransitions: Record<Task["escalationLevel"], Task["escalationLevel"][]> = {
      NONE: ["MCC", "LOG_COMD"],
      MCC: ["LOG_COMD"],
      LOG_COMD: [],
    };

    if (current === next) {
      return;
    }

    if (!allowedTransitions[current].includes(next)) {
      throw new Error(`Invalid escalation transition: ${current} -> ${next}`);
    }
  }

  private assertValidRole(role: RoleId, fieldName: string): void {
    if (!this.isRoleId(role)) {
      logger.error("role_validation_failed", new Error(`Invalid ${fieldName}`), {
        actionType: fieldName,
        status: String(role),
      });
      throw new Error(`Invalid ${fieldName}: ${String(role)}`);
    }
  }

  private assertValidAssignedRole(role: AssignedRoleId, fieldName: string): void {
    if (!this.isAssignedRoleId(role)) {
      logger.error("assigned_role_validation_failed", new Error(`Invalid ${fieldName}`), {
        actionType: fieldName,
        status: String(role),
      });
      throw new Error(`Invalid ${fieldName}: ${String(role)}`);
    }
  }

  private assertValidShipId(shipId: string): void {
    if (typeof shipId !== "string" || shipId.trim() === "") {
      logger.error("ship_id_validation_failed", new Error("Invalid shipId"), {
        actionType: "shipId",
        status: String(shipId),
      });
      throw new Error(`Invalid shipId: ${String(shipId)}`);
    }
  }

  private assertValidShip(ship: Ship): void {
    if (
      typeof ship.id !== "string" ||
      ship.id.trim() === "" ||
      typeof ship.name !== "string" ||
      ship.name.trim() === "" ||
      typeof ship.classType !== "string" ||
      ship.classType.trim() === ""
    ) {
      logger.error("ship_validation_failed", new Error("Invalid ship"), {
        actionType: "ship",
        status: ship.id ?? "UNKNOWN",
      });
      throw new Error("Invalid ship");
    }
  }

  private assertShipExists(shipId: string): void {
    if (!this.shipsById.has(shipId)) {
      logger.error("ship_not_found", new Error("Unknown ship"), {
        actionType: "shipId",
        status: shipId,
      });
      throw new Error(`Unknown shipId: ${shipId}`);
    }
  }

  private loadPersistedState(): void {
    const loaded =
      this.tryLoadFromPath(this.persistenceFilePath)
      ?? this.tryLoadFromPath(this.backupFilePath);

    if (!loaded) {
      this.resetPersistedState();
      return;
    }

    const { state: persisted, path } = loaded;

    this.tasksById.clear();
    this.shipsById.clear();
    for (const ship of persisted.ships) {
      this.shipsById.set(ship.id, ship);
    }

    for (const task of persisted.tasks) {
      this.tasksById.set(task.id, task);
    }

    this.taskHistoryById.clear();
    for (const [taskId, history] of persisted.taskHistory) {
      this.taskHistoryById.set(taskId, history);
    }

    this.escalationByDate.clear();
    for (const [businessDate, escalationState] of persisted.escalationState) {
      this.escalationByDate.set(businessDate, escalationState);
    }

    this.notificationsById.clear();
    for (const notification of persisted.notifications) {
      this.notificationsById.set(notification.id, notification);
    }

    try {
      this.lastPersistenceTimestamp = statSync(path).mtime.toISOString();
    } catch (error) {
      logger.error("persisted_state_stat_failed", error, {
        result: path,
        status: "STAT_FAILED",
      });
      this.lastPersistenceTimestamp = null;
    }
  }

  private tryLoadFromPath(path: string): { state: PersistedStoreState; path: string } | null {
    if (!existsSync(path)) {
      return null;
    }

    try {
      const raw = readFileSync(path, "utf8");
      if (raw.trim() === "") {
        logger.warn("persisted_state_empty", { result: path, status: "EMPTY" });
        return null;
      }

      const parsed = JSON.parse(raw);
      const migrated = this.tryMigratePersistedState(parsed, path);
      if (!migrated) {
        logger.warn("persisted_state_invalid", { result: path, status: "INVALID" });
        return null;
      }
      if (!this.validatePersistedState(migrated)) {
        logger.warn("persisted_state_invalid", { result: path, status: "INVALID" });
        return null;
      }
      return { state: migrated, path };
    } catch (error) {
      logger.error("persisted_state_load_failed", error, {
        result: path,
        status: "LOAD_FAILED",
      });
      return null;
    }
  }

  private validatePersistedState(value: unknown): value is PersistedStoreState {
    if (!isRecord(value)) {
      return false;
    }

    if (value.version !== STORE_STATE_VERSION) {
      return false;
    }

    if (!Array.isArray(value.tasks) || !value.tasks.every((item) => this.isTask(item))) {
      return false;
    }

    if (!Array.isArray(value.ships) || !value.ships.every((item) => this.isShip(item))) {
      return false;
    }

    if (
      !Array.isArray(value.taskHistory) ||
      !value.taskHistory.every((entry) => this.isTaskHistoryTuple(entry))
    ) {
      return false;
    }

    if (
      !Array.isArray(value.escalationState) ||
      !value.escalationState.every((entry) => this.isEscalationStateTuple(entry))
    ) {
      return false;
    }

    if (
      !Array.isArray(value.notifications) ||
      !value.notifications.every((entry) => this.isNotification(entry))
    ) {
      return false;
    }

    return true;
  }

  private tryMigratePersistedState(
    value: unknown,
    path: string,
  ): PersistedStoreState | null {
    if (!isRecord(value)) {
      return null;
    }

    if (value.version === STORE_STATE_VERSION) {
      return value as unknown as PersistedStoreState;
    }

    logger.warn("persisted_state_version_mismatch", {
      result: path,
      status: `EXPECTED_${STORE_STATE_VERSION}_RECEIVED_${String(value.version ?? "UNKNOWN")}`,
    });
    logger.warn("persisted_state_migration_unavailable", {
      result: path,
      status: "NO_MIGRATION_PATH_CONFIGURED",
    });
    return null;
  }

  private isTask(value: unknown): value is Task {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.id === "string" &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      isNullableString(value.parentTaskId) &&
      (value.kind === "PMS" || value.kind === "DEFECT") &&
      typeof value.title === "string" &&
      typeof value.businessDate === "string" &&
      typeof value.dueDate === "string" &&
      this.isAssignedRoleId(value.assignedRole) &&
      (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
      isNullableString(value.completedAt) &&
      isNullableString(value.lastCheckedAt) &&
      isNullableString(value.lastOverdueAt) &&
      isNullableString(value.replannedFromDueDate) &&
      isNullableString(value.replannedToDueDate) &&
      isNullableString(value.lastNotifiedAt) &&
      (typeof value.ettrDays === "number" || value.ettrDays === null) &&
      (value.severity === "ROUTINE" ||
        value.severity === "URGENT" ||
        value.severity === "CRITICAL" ||
        value.severity === null) &&
      (value.escalationLevel === "NONE" ||
        value.escalationLevel === "MCC" ||
        value.escalationLevel === "LOG_COMD") &&
      isNullableString(value.escalatedAt)
    );
  }

  private isShip(value: unknown): value is Ship {
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      value.id.trim() !== "" &&
      typeof value.name === "string" &&
      value.name.trim() !== "" &&
      typeof value.classType === "string" &&
      value.classType.trim() !== ""
    );
  }

  private isTaskHistoryTuple(value: unknown): value is [string, TaskHistoryEntry[]] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      Array.isArray(value[1]) &&
      value[1].every((entry) => this.isTaskHistoryEntry(entry))
    );
  }

  private isTaskHistoryEntry(value: unknown): value is TaskHistoryEntry {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.taskId === "string" &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      typeof value.timestamp === "string" &&
      this.isTaskHistoryType(value.actionType) &&
      this.isTaskStateSnapshot(value.previousState) &&
      this.isTaskStateSnapshot(value.newState) &&
      (value.actor === "SYSTEM" || this.isRoleId(value.actor))
    );
  }

  private isTaskStateSnapshot(value: unknown): value is TaskStateSnapshot {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      isNullableString(value.parentTaskId) &&
      (value.kind === "PMS" || value.kind === "DEFECT") &&
      (value.assignedRole === "COMMANDING_OFFICER" ||
        value.assignedRole === "MARINE_ENGINEERING_OFFICER" ||
        value.assignedRole === "WEAPON_ELECTRICAL_OFFICER" ||
        value.assignedRole === "FLEET_SUPPORT_GROUP" ||
        value.assignedRole === "LOGISTICS_COMMAND") &&
      (value.status === "PENDING" || value.status === "COMPLETED" || value.status === "OVERDUE") &&
      isNullableString(value.completedAt) &&
      isNullableString(value.lastCheckedAt) &&
      isNullableString(value.lastOverdueAt) &&
      isNullableString(value.replannedFromDueDate) &&
      isNullableString(value.replannedToDueDate) &&
      (value.escalationLevel === "NONE" ||
        value.escalationLevel === "MCC" ||
        value.escalationLevel === "LOG_COMD") &&
      typeof value.dueDate === "string" &&
      isNullableString(value.lastNotifiedAt) &&
      (typeof value.ettrDays === "number" || value.ettrDays === null) &&
      (value.severity === "ROUTINE" ||
        value.severity === "URGENT" ||
        value.severity === "CRITICAL" ||
        value.severity === null) &&
      isNullableString(value.escalatedAt)
    );
  }

  private isEscalationStateTuple(value: unknown): value is [string, EscalationState] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      this.isEscalationState(value[1])
    );
  }

  private isEscalationState(value: unknown): value is EscalationState {
    if (!isRecord(value)) {
      return false;
    }

    return (
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      typeof value.businessDate === "string" &&
      (value.status === "NOT_ESCALATED" || value.status === "ESCALATED_TO_CO") &&
      (value.reason === "MISSING_DAILY_LOGS" || value.reason === null) &&
      Array.isArray(value.missingLogsAtEscalation) &&
      value.missingLogsAtEscalation.every(
        (item) =>
          item === "ENGINE_ROOM_REGISTER" || item === "EQUIPMENT_OPERATION_RECORD",
      ) &&
      isNullableString(value.escalatedAt) &&
      (value.targetRole === null || this.isRoleId(value.targetRole))
    );
  }

  private isNotification(value: unknown): value is Notification {
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.type === "string" &&
      value.type.trim() !== "" &&
      (typeof value.dedupeKey === "undefined" ||
        (typeof value.dedupeKey === "string" && value.dedupeKey.trim() !== "")) &&
      typeof value.shipId === "string" &&
      value.shipId.trim() !== "" &&
      isNullableString(value.taskId) &&
      typeof value.message === "string" &&
      this.isRoleId(value.targetRole) &&
      typeof value.timestamp === "string" &&
      typeof value.read === "boolean"
    );
  }

  private buildNotificationDedupeKey(
    input: Omit<Notification, "id" | "read">,
  ): string {
    return [
      input.shipId,
      input.type,
      input.taskId ?? "NO_TASK",
    ].join("|");
  }

  private isRoleId(value: unknown): value is RoleId {
    return (
      value === "COMMANDING_OFFICER" ||
      value === "MARINE_ENGINEERING_OFFICER" ||
      value === "WEAPON_ELECTRICAL_OFFICER" ||
      value === "FLEET_SUPPORT_GROUP" ||
      value === "LOGISTICS_COMMAND" ||
      value === "SYSTEM"
    );
  }

  private isAssignedRoleId(value: unknown): value is AssignedRoleId {
    return (
      value === "COMMANDING_OFFICER" ||
      value === "MARINE_ENGINEERING_OFFICER" ||
      value === "WEAPON_ELECTRICAL_OFFICER" ||
      value === "FLEET_SUPPORT_GROUP" ||
      value === "LOGISTICS_COMMAND"
    );
  }

  private isTaskHistoryType(value: unknown): value is TaskHistoryType {
    return (
      value === "CREATED" ||
      value === "CHECKED" ||
      value === "STATUS_CHANGED" ||
      value === "REPLANNED" ||
      value === "NOTIFIED" ||
      value === "COMPLETED" ||
      value === "ESCALATED"
    );
  }

  private resetPersistedState(): void {
    this.shipsById.clear();
    this.tasksById.clear();
    this.taskHistoryById.clear();
    this.escalationByDate.clear();
    this.notificationsById.clear();
  }

  private persistState(): void {
    const payload: PersistedStoreState = {
      version: STORE_STATE_VERSION,
      ships: [...this.shipsById.values()],
      tasks: [...this.tasksById.values()],
      taskHistory: [...this.taskHistoryById.entries()],
      escalationState: [...this.escalationByDate.entries()],
      notifications: [...this.notificationsById.values()],
    };

    const serialized = JSON.stringify(payload, null, 2);
    mkdirSync(dirname(this.persistenceFilePath), { recursive: true });

    try {
      writeFileSync(this.tempFilePath, serialized, "utf8");

      if (existsSync(this.backupFilePath)) {
        rmSync(this.backupFilePath);
      }

      if (existsSync(this.persistenceFilePath)) {
        renameSync(this.persistenceFilePath, this.backupFilePath);
      }

      renameSync(this.tempFilePath, this.persistenceFilePath);
      this.lastPersistenceTimestamp = new Date().toISOString();
    } catch (error) {
      if (existsSync(this.tempFilePath)) {
        rmSync(this.tempFilePath);
      }
      logger.error("persistence_write_failed", error, {
        result: this.persistenceFilePath,
        status: "WRITE_FAILED",
      });
      throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}
