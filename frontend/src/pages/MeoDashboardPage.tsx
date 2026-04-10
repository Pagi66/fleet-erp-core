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
import { useMeoDashboardState } from "../state/meo-dashboard-store";
import { createMeoDashboardViewModel } from "../view-models/meo-dashboard.vm";

export function MeoDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shipId = searchParams.get("shipId");
  const dashboard = useMeoDashboardState(shipId);
  const viewModel = dashboard.data ? createMeoDashboardViewModel(dashboard.data) : null;

  if (dashboard.status === "loading") {
    return <Alert severity="info">Loading MEO dashboard...</Alert>;
  }

  if (dashboard.error || !viewModel) {
    return <Alert severity="error">{dashboard.error ?? "MEO dashboard is unavailable"}</Alert>;
  }

  return (
    <DashboardShell
      role="MARINE_ENGINEERING_OFFICER"
      title="MEO Dashboard"
      subtitle="Engineering readiness and log/compliance control."
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
          <Alert severity="info">Select a ship to load engineering readiness data.</Alert>
        ) : (
          <KpiCardGrid items={viewModel.kpis} />
        )
      }
      primary={
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Overdue Task Queue</Typography>
            <DataTable
              columns={viewModel.overdueColumns}
              rows={viewModel.overdueRows}
              getRowKey={(row) => row.id}
              emptyMessage="No overdue MEO tasks for the selected ship."
            />
          </Stack>
        </Paper>
      }
      secondary={
        <Stack spacing={3}>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Compliance Attention
            </Typography>
            <ExceptionList
              items={viewModel.signalItems}
              emptyMessage="No warning or critical compliance issues."
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
