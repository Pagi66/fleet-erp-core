import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useSearchParams } from "react-router-dom";
import { DashboardShell } from "../components/dashboard/DashboardShell";
import { DataTable } from "../components/dashboard/DataTable";
import { ExceptionList } from "../components/dashboard/ExceptionList";
import { KpiCardGrid } from "../components/dashboard/KpiCardGrid";
import { ShipSelector } from "../components/dashboard/ShipSelector";
import { useWeoDashboardState } from "../state/weo-dashboard-store";
import { createWeoDashboardViewModel } from "../view-models/weo-dashboard.vm";

export function WeoDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shipId = searchParams.get("shipId");
  const dashboard = useWeoDashboardState(shipId);
  const viewModel = dashboard.data ? createWeoDashboardViewModel(dashboard.data) : null;

  if (dashboard.status === "loading") {
    return <Alert severity="info">Loading WEO dashboard...</Alert>;
  }

  if (dashboard.error || !viewModel) {
    return <Alert severity="error">{dashboard.error ?? "WEO dashboard is unavailable"}</Alert>;
  }

  return (
    <DashboardShell
      role="WEAPON_ELECTRICAL_OFFICER"
      title="WEO Dashboard"
      subtitle="Weapon and electrical readiness for the selected ship."
      shipSelector={
        <ShipSelector
          shipId={viewModel.selectedShipId}
          options={viewModel.shipOptions}
          onChange={(nextShipId) => {
            const next = new URLSearchParams(searchParams);
            if (nextShipId) {
              next.set("shipId", nextShipId);
            } else {
              next.delete("shipId");
            }
            setSearchParams(next);
          }}
        />
      }
      kpis={
        viewModel.needsShipSelection ? (
          <Alert severity="info">Select a ship to load WEO readiness data.</Alert>
        ) : (
          <KpiCardGrid items={viewModel.kpis} />
        )
      }
      primary={
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Critical Work Queue</Typography>
            <DataTable
              columns={viewModel.taskColumns}
              rows={viewModel.taskRows}
              getRowKey={(row) => row.id}
              emptyMessage="No overdue WEO tasks for the selected ship."
            />
          </Stack>
        </Paper>
      }
      secondary={
        <Stack spacing={3}>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Critical Compliance Signals
            </Typography>
            <ExceptionList
              items={viewModel.signalItems}
              emptyMessage="No critical compliance issues for this ship."
            />
          </div>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Notifications
            </Typography>
            <ExceptionList
              items={viewModel.notificationItems}
              emptyMessage="No notifications for this ship."
            />
          </div>
        </Stack>
      }
    />
  );
}
