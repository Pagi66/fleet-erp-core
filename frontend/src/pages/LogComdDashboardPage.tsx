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
import { useLogComdDashboardState } from "../state/log-comd-dashboard-store";
import { createLogComdDashboardViewModel } from "../view-models/log-comd-dashboard.vm";

export function LogComdDashboardPage() {
  const dashboard = useLogComdDashboardState();
  const viewModel = dashboard.data ? createLogComdDashboardViewModel(dashboard.data) : null;

  if (dashboard.status === "loading") {
    return <Alert severity="info">Loading Log Comd dashboard...</Alert>;
  }

  if (dashboard.error || !viewModel) {
    return <Alert severity="error">{dashboard.error ?? "Log Comd dashboard is unavailable"}</Alert>;
  }

  return (
    <DashboardShell
      role="LOGISTICS_COMMAND"
      title="Log Comd Dashboard"
      subtitle="Major maintenance and command-level approval bottlenecks."
      kpis={<KpiCardGrid items={viewModel.kpis} />}
      primary={
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Actionable Command Queue</Typography>
            <DataTable
              columns={[
                ...viewModel.actionableColumns.slice(0, 1),
                {
                  key: "detail",
                  header: "Detail",
                  render: (row) => (
                    <Button component={RouterLink} to={row.detailHref} size="small">
                      Open record
                    </Button>
                  ),
                },
                ...viewModel.actionableColumns.slice(1),
              ]}
              rows={viewModel.actionableRows}
              getRowKey={(row) => row.recordId}
              emptyMessage="No actionable Log Comd records."
            />
          </Stack>
        </Paper>
      }
      secondary={
        <Stack spacing={3}>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Stale / Rejected Attention
            </Typography>
            <ExceptionList
              items={viewModel.blockedItems}
              emptyMessage="No stale or rejected command records."
            />
          </div>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Counts by Ship
            </Typography>
            <DataTable
              columns={viewModel.shipColumns}
              rows={viewModel.shipRows}
              getRowKey={(row) => row.shipId}
              emptyMessage="No visible ship counts are available."
            />
          </div>
        </Stack>
      }
    />
  );
}
