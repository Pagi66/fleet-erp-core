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
import { useFsgDashboardState } from "../state/fsg-dashboard-store";
import { createFsgDashboardViewModel } from "../view-models/fsg-dashboard.vm";

export function FsgDashboardPage() {
  const dashboard = useFsgDashboardState();
  const viewModel = dashboard.data ? createFsgDashboardViewModel(dashboard.data) : null;

  if (dashboard.status === "loading") {
    return <Alert severity="info">Loading FSG dashboard...</Alert>;
  }

  if (dashboard.error || !viewModel) {
    return <Alert severity="error">{dashboard.error ?? "FSG dashboard is unavailable"}</Alert>;
  }

  return (
    <DashboardShell
      role="FLEET_SUPPORT_GROUP"
      title="FSG Dashboard"
      subtitle="Intermediate maintenance and approval-awareness workload."
      kpis={<KpiCardGrid items={viewModel.kpis} />}
      primary={
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">Actionable Record Queue</Typography>
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
              emptyMessage="No actionable FSG records."
            />
          </Stack>
        </Paper>
      }
      secondary={
        <Stack spacing={3}>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Stale Records
            </Typography>
            <ExceptionList
              items={viewModel.staleItems}
              emptyMessage="No stale FSG records."
            />
          </div>
          <div>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Workload by Ship
            </Typography>
            <DataTable
              columns={viewModel.shipColumns}
              rows={viewModel.shipRows}
              getRowKey={(row) => row.shipId}
              emptyMessage="No visible ship workload is available."
            />
          </div>
        </Stack>
      }
    />
  );
}
