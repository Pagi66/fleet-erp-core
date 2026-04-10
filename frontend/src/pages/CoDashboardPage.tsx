import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";
import { DashboardShell } from "../components/dashboard/DashboardShell";
import { DataTable } from "../components/dashboard/DataTable";
import { ExceptionList } from "../components/dashboard/ExceptionList";
import { KpiCardGrid } from "../components/dashboard/KpiCardGrid";
import { useCoDashboardState } from "../state/co-dashboard-store";
import { createCoDashboardViewModel } from "../view-models/co-dashboard.vm";

export function CoDashboardPage() {
  const dashboard = useCoDashboardState();
  const viewModel = dashboard.data ? createCoDashboardViewModel(dashboard.data) : null;

  if (dashboard.status === "loading") {
    return <Alert severity="info">Loading CO dashboard...</Alert>;
  }

  if (dashboard.error || !viewModel) {
    return <Alert severity="error">{dashboard.error ?? "CO dashboard is unavailable"}</Alert>;
  }

  return (
    <DashboardShell
      role="COMMANDING_OFFICER"
      title="CO Dashboard"
      subtitle="Fleet-wide command overview and exception scanning."
      kpis={<KpiCardGrid items={viewModel.kpis} />}
      primary={
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Fleet Readiness</Typography>
            <DataTable
              columns={[
                ...viewModel.fleetColumns.slice(0, 1),
                {
                  key: "detail",
                  header: "Drill-down",
                  render: (row) => (
                    <Button component={RouterLink} to={row.detailHref} size="small">
                      Open ship
                    </Button>
                  ),
                },
                ...viewModel.fleetColumns.slice(1),
              ]}
              rows={viewModel.fleetRows}
              getRowKey={(row) => row.shipId}
              emptyMessage="No ship readiness data is available."
            />
          </Stack>
        </Paper>
      }
      secondary={
        <Stack spacing={3}>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Critical Signals
            </Typography>
            <ExceptionList
              items={viewModel.criticalSignalItems}
              emptyMessage="No critical compliance signals detected."
            />
          </div>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Failed Events
            </Typography>
            <ExceptionList
              items={viewModel.failedEventItems}
              emptyMessage="No failed events recorded."
            />
          </div>
        </Stack>
      }
    />
  );
}
