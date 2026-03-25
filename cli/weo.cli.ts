import type { ActorContext } from "../src/core/types";
import { runShipWorkspaceCli } from "./ship-workspace.cli";
import { CliApp, type CliPromptLike, getShipDisplayName } from "./shared";

export async function runWeoCli(
  rl: CliPromptLike,
  app: CliApp,
  actor: ActorContext,
): Promise<void> {
  await runShipWorkspaceCli(rl, app, actor, {
    title: "WEO WORKSPACE",
    subtitle: "Electrical and weapon-system reporting for the assigned ship.",
    menuItems: [
      {
        label: "Equipment Operation Record",
        buildDetail: ({ app: localApp, actor: localActor, businessDate }) => {
          const logs = localApp.store.getLogsForDate(localActor.shipId, businessDate);
          const equipmentRecord = logs.find(
            (entry) => entry.logType === "EQUIPMENT_OPERATION_RECORD",
          );
          return [
            `Ship: ${getShipDisplayName(localApp, localActor.shipId)}`,
            `Equipment Operation Record: ${equipmentRecord ? "PRESENT" : "MISSING"}`,
            `Submitted At: ${equipmentRecord?.submittedAt ?? "Not yet submitted"}`,
          ];
        },
      },
      {
        label: "Electrical / Weapon Defects",
        buildDetail: ({ records }) => {
          const defects = records.filter((record) => record.kind === "DEFECT");
          return [
            `Visible defect records: ${defects.length}`,
            `Open submitted defects: ${defects.filter((record) => record.approval.status === "SUBMITTED").length}`,
            `Rejected defects awaiting correction: ${defects.filter((record) => record.approval.status === "REJECTED").length}`,
          ];
        },
      },
      {
        label: "Maintenance Tasks",
        buildDetail: ({ tasks }) => {
          const pmsTasks = tasks.filter((task) => task.kind === "PMS");
          return [
            `Assigned maintenance tasks: ${tasks.length}`,
            `PMS tasks: ${pmsTasks.length}`,
            `Overdue tasks: ${tasks.filter((task) => task.status === "OVERDUE").length}`,
          ];
        },
      },
      {
        label: "Technical Requests",
        buildDetail: ({ records }) => {
          const requests = records.filter((record) => record.kind === "WORK_REQUEST");
          return [
            `Visible technical requests: ${requests.length}`,
            `Approved requests: ${requests.filter((record) => record.approval.status === "APPROVED").length}`,
            `Pending requests: ${requests.filter((record) => record.approval.status === "SUBMITTED").length}`,
          ];
        },
      },
      {
        label: "Weekly Returns",
        buildDetail: ({ records }) => [
          `Visible ship records this week: ${records.length}`,
          "Use this summary to prepare weekly electrical and weapons-system returns.",
        ],
      },
      {
        label: "Monthly Returns",
        buildDetail: ({ records }) => [
          `Visible ship records this month: ${records.length}`,
          "Use this summary to consolidate longer-horizon equipment readiness trends.",
        ],
      },
    ],
  });
}
