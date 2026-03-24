const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const workspace = path.resolve(__dirname, "..");
const tscCommand =
  process.platform === "win32"
    ? path.join(workspace, "node_modules", ".bin", "tsc.cmd")
    : path.join(workspace, "node_modules", ".bin", "tsc");

function fail(message) {
  console.error(`APPROVAL SMOKE FAILED: ${message}`);
  process.exit(1);
}

function run(command, args) {
  const isWindowsCmd = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const result = isWindowsCmd
    ? spawnSync(`${command} ${args.join(" ")}`, {
        cwd: workspace,
        stdio: "inherit",
        shell: true,
        env: process.env,
      })
    : spawnSync(command, args, {
        cwd: workspace,
        stdio: "inherit",
        shell: false,
        env: process.env,
      });

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

run(tscCommand, ["--noEmit"]);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-approval-smoke-"));
process.env.PERSISTENCE_FILE_PATH = path.join(tempRoot, "store-state.json");

const tsNodeRegister = require.resolve("ts-node/register", { paths: [workspace] });
require(tsNodeRegister);

const { createDailyLogEngineApp } = require(path.join(workspace, "src", "index.ts"));
const {
  createApprovalRecordCreateEvent,
  createApprovalTransitionEvent,
} = require(path.join(workspace, "src", "events", "approval-events.ts"));

const app = createDailyLogEngineApp();

function emit(event) {
  app.eventBus.emit(event);
}

function createRecord(shipId, recordId, title, businessDate, occurredAt, actor) {
  emit(createApprovalRecordCreateEvent(
    shipId,
    recordId,
    "WORK_REQUEST",
    title,
    businessDate,
    occurredAt,
    actor,
    "Smoke approval record",
  ));
}

function transition(type, shipId, recordId, businessDate, occurredAt, actor, transitionId, reason, note) {
  emit(createApprovalTransitionEvent(
    type,
    shipId,
    recordId,
    businessDate,
    occurredAt,
    actor,
    transitionId,
    reason,
    note,
  ));
}

try {
  const shipId = "APPROVAL-SMOKE-01";
  const businessDate = "2026-03-24";

  app.store.saveShip({
    id: shipId,
    name: "Approval Smoke Ship",
    classType: "Test Class",
  });

  createRecord(
    shipId,
    "REC-APPROVE-01",
    "Approval happy path",
    businessDate,
    "2026-03-24T09:00:00.000Z",
    "MARINE_ENGINEERING_OFFICER",
  );

  let view = app.store.getApprovalRecordViewInShip("REC-APPROVE-01", shipId);
  assert(view.record, "record should be created");
  assert(view.record.approval.status === "DRAFT", "record should start in DRAFT");
  assert(view.record.approval.currentOwner === "MARINE_ENGINEERING_OFFICER", "draft owner should be MEO");
  assert(view.record.approval.approvalLevel === 0, "draft approval level should be 0");
  assert(view.record.visibleTo.includes("LOGISTICS_COMMAND"), "higher roles should be able to view lower-level records");

  transition(
    "APPROVAL_RECORD_SUBMIT",
    shipId,
    "REC-APPROVE-01",
    businessDate,
    "2026-03-24T09:10:00.000Z",
    "MARINE_ENGINEERING_OFFICER",
    "txn-submit-01",
    "Forward to CO",
    "Initial submission note",
  );
  view = app.store.getApprovalRecordViewInShip("REC-APPROVE-01", shipId);
  assert(view.record.approval.status === "SUBMITTED", "submit should move record into SUBMITTED");
  assert(view.record.approval.currentOwner === "COMMANDING_OFFICER", "submit should move ownership to CO");
  assert(view.record.approval.approvalLevel === 1, "submit should increment approval level");

  transition(
    "APPROVAL_RECORD_APPROVE",
    shipId,
    "REC-APPROVE-01",
    businessDate,
    "2026-03-24T09:20:00.000Z",
    "COMMANDING_OFFICER",
    "txn-approve-01",
    "CO cleared",
    "CO review note",
  );
  transition(
    "APPROVAL_RECORD_APPROVE",
    shipId,
    "REC-APPROVE-01",
    businessDate,
    "2026-03-24T09:30:00.000Z",
    "FLEET_SUPPORT_GROUP",
    "txn-approve-02",
    "FSG cleared",
    "FSG review note",
  );
  transition(
    "APPROVAL_RECORD_APPROVE",
    shipId,
    "REC-APPROVE-01",
    businessDate,
    "2026-03-24T09:40:00.000Z",
    "LOGISTICS_COMMAND",
    "txn-approve-03",
    "Final approval",
    "LOG_COMD final note",
  );

  view = app.store.getApprovalRecordViewInShip("REC-APPROVE-01", shipId);
  assert(view.record.approval.status === "APPROVED", "final approval should make the record terminal APPROVED");
  assert(view.record.approval.currentOwner === "LOGISTICS_COMMAND", "terminal owner should remain LOGISTICS_COMMAND");
  assert(
    view.history.some((entry) => entry.transitionId === "txn-approve-03" && entry.reason === "Final approval" && entry.note === "LOG_COMD final note"),
    "approval history should preserve reason and note",
  );

  transition(
    "APPROVAL_RECORD_APPROVE",
    shipId,
    "REC-APPROVE-01",
    businessDate,
    "2026-03-24T09:40:00.000Z",
    "LOGISTICS_COMMAND",
    "txn-approve-03",
  );
  view = app.store.getApprovalRecordViewInShip("REC-APPROVE-01", shipId);
  assert(
    view.history.filter((entry) => entry.transitionId === "txn-approve-03" && entry.actionType === "APPROVED").length === 1,
    "duplicate transitionId should be idempotent",
  );

  transition(
    "APPROVAL_RECORD_REJECT",
    shipId,
    "REC-APPROVE-01",
    businessDate,
    "2026-03-24T09:50:00.000Z",
    "LOGISTICS_COMMAND",
    "txn-terminal-block",
  );
  view = app.store.getApprovalRecordViewInShip("REC-APPROVE-01", shipId);
  assert(view.record.approval.status === "APPROVED", "terminal state should remain unchanged after blocked transition");
  assert(
    view.history.some((entry) => entry.actionType === "INVALID_ATTEMPT" && entry.transitionId === "txn-terminal-block"),
    "blocked terminal transitions should be logged as invalid attempts",
  );

  createRecord(
    shipId,
    "REC-REJECT-CO",
    "Reject at CO",
    businessDate,
    "2026-03-24T10:00:00.000Z",
    "MARINE_ENGINEERING_OFFICER",
  );
  transition(
    "APPROVAL_RECORD_SUBMIT",
    shipId,
    "REC-REJECT-CO",
    businessDate,
    "2026-03-24T10:05:00.000Z",
    "MARINE_ENGINEERING_OFFICER",
    "txn-submit-co",
    "Send to CO",
    "CO rejection path note",
  );
  transition(
    "APPROVAL_RECORD_REJECT",
    shipId,
    "REC-REJECT-CO",
    businessDate,
    "2026-03-24T10:10:00.000Z",
    "COMMANDING_OFFICER",
    "txn-reject-co",
    "Needs correction",
    "Return to originator",
  );
  view = app.store.getApprovalRecordViewInShip("REC-REJECT-CO", shipId);
  assert(view.record.approval.status === "REJECTED", "CO rejection should set terminal REJECTED");
  assert(view.record.approval.currentOwner === "MARINE_ENGINEERING_OFFICER", "CO rejection should return ownership to MEO");
  assert(
    view.history.some((entry) => entry.transitionId === "txn-reject-co" && entry.reason === "Needs correction" && entry.note === "Return to originator"),
    "rejection history should preserve reason and note",
  );

  createRecord(
    shipId,
    "REC-REJECT-FSG",
    "Reject at FSG",
    businessDate,
    "2026-03-24T10:20:00.000Z",
    "MARINE_ENGINEERING_OFFICER",
  );
  transition("APPROVAL_RECORD_SUBMIT", shipId, "REC-REJECT-FSG", businessDate, "2026-03-24T10:21:00.000Z", "MARINE_ENGINEERING_OFFICER", "txn-submit-fsg");
  transition("APPROVAL_RECORD_APPROVE", shipId, "REC-REJECT-FSG", businessDate, "2026-03-24T10:22:00.000Z", "COMMANDING_OFFICER", "txn-approve-fsg-1");
  transition("APPROVAL_RECORD_REJECT", shipId, "REC-REJECT-FSG", businessDate, "2026-03-24T10:23:00.000Z", "FLEET_SUPPORT_GROUP", "txn-reject-fsg", "Needs CO rework", "Return to CO");
  view = app.store.getApprovalRecordViewInShip("REC-REJECT-FSG", shipId);
  assert(view.record.approval.currentOwner === "COMMANDING_OFFICER", "FSG rejection should return ownership to CO");

  createRecord(
    shipId,
    "REC-INVALID-01",
    "Invalid approval attempt",
    businessDate,
    "2026-03-24T10:30:00.000Z",
    "MARINE_ENGINEERING_OFFICER",
  );
  transition("APPROVAL_RECORD_SUBMIT", shipId, "REC-INVALID-01", businessDate, "2026-03-24T10:31:00.000Z", "MARINE_ENGINEERING_OFFICER", "txn-submit-invalid");
  transition(
    "APPROVAL_RECORD_APPROVE",
    shipId,
    "REC-INVALID-01",
    businessDate,
    "2026-03-24T10:32:00.000Z",
    "WEAPON_ELECTRICAL_OFFICER",
    "txn-invalid-owner",
    "Unauthorized approve",
    "Wrong role note",
  );
  view = app.store.getApprovalRecordViewInShip("REC-INVALID-01", shipId);
  assert(
    view.history.some((entry) => entry.actionType === "INVALID_ATTEMPT" && entry.transitionId === "txn-invalid-owner"),
    "invalid approval attempts should be logged in approval history",
  );
  assert(
    view.history.some((entry) => entry.transitionId === "txn-invalid-owner" && entry.reason === "Only the current owner may approve the record" && entry.note === "Wrong role note"),
    "invalid attempt history should preserve reason and note",
  );
  assert(
    view.record.approval.currentOwner === "COMMANDING_OFFICER",
    "invalid approval attempts must not mutate ownership",
  );

  transition(
    "APPROVAL_RECORD_REJECT",
    shipId,
    "REC-INVALID-01",
    businessDate,
    "2026-03-24T10:33:00.000Z",
    "COMMANDING_OFFICER",
    "txn-submit-invalid",
    "Conflicting action",
    "Transition identity conflict note",
  );
  view = app.store.getApprovalRecordViewInShip("REC-INVALID-01", shipId);
  assert(
    view.history.some((entry) => entry.actionType === "INVALID_ATTEMPT" && entry.transitionId === "txn-submit-invalid"),
    "conflicting transition ids should be audited",
  );

  createRecord(
    shipId,
    "REC-WEO-01",
    "Visibility from WEO lane",
    businessDate,
    "2026-03-24T10:40:00.000Z",
    "WEAPON_ELECTRICAL_OFFICER",
  );
  const meoVisible = app.store.getApprovalRecordsVisibleToRole(shipId, "MARINE_ENGINEERING_OFFICER");
  const coVisible = app.store.getApprovalRecordsVisibleToRole(shipId, "COMMANDING_OFFICER");
  assert(!meoVisible.some((record) => record.id === "REC-WEO-01"), "MEO should not see WEO-origin draft records");
  assert(coVisible.some((record) => record.id === "REC-WEO-01"), "CO should see lower-level records across origin lanes");

  createRecord(
    shipId,
    "REC-STALE-01",
    "Stale approval",
    businessDate,
    "2026-03-24T06:00:00.000Z",
    "MARINE_ENGINEERING_OFFICER",
  );
  app.scheduler.triggerApprovalStaleCheck(
    shipId,
    businessDate,
    "2026-03-25T07:00:00.000Z",
    24,
  );
  const staleNotifications = app.store.getNotifications(shipId, "MARINE_ENGINEERING_OFFICER");
  assert(
    staleNotifications.some((notification) => notification.type === "APPROVAL_STALE" && notification.recordId === "REC-STALE-01"),
    "stale check should notify the current owner only",
  );

  console.log("Approval workflow smoke check passed.");
} finally {
  app.shutdown();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
