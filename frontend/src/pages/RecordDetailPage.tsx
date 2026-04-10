import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useParams, useSearchParams } from "react-router-dom";
import { ExceptionList } from "../components/dashboard/ExceptionList";
import { useRecordDetailState } from "../state/record-detail-store";
import type { DashboardRole } from "../types/roles";
import { createRecordDetailViewModel } from "../view-models/record-detail.vm";

function isDashboardRole(value: string | null): value is DashboardRole {
  return (
    value === "COMMANDING_OFFICER" ||
    value === "MARINE_ENGINEERING_OFFICER" ||
    value === "WEAPON_ELECTRICAL_OFFICER" ||
    value === "FLEET_SUPPORT_GROUP" ||
    value === "LOGISTICS_COMMAND"
  );
}

export function RecordDetailPage() {
  const { recordId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const roleParam = searchParams.get("role");
  const role = isDashboardRole(roleParam) ? roleParam : null;
  const detail = useRecordDetailState(recordId, role);
  const viewModel = detail.data ? createRecordDetailViewModel(detail.data) : null;

  if (detail.status === "loading") {
    return <Alert severity="info">Loading record detail...</Alert>;
  }

  if (detail.error || !viewModel) {
    return <Alert severity="error">{detail.error ?? "Record detail is unavailable"}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <div>
        <Typography variant="overline" color="text.secondary">
          Record Detail
        </Typography>
        <Typography variant="h4">{viewModel.title}</Typography>
        <Typography color="text.secondary">{viewModel.subtitle}</Typography>
      </div>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1.5}>
          {viewModel.metadata.map((entry) => (
            <Stack
              key={entry.label}
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
            >
              <Typography sx={{ minWidth: 160, fontWeight: 600 }}>{entry.label}</Typography>
              <Typography color="text.secondary">{entry.value}</Typography>
            </Stack>
          ))}
        </Stack>
      </Paper>

      <div>
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          History
        </Typography>
        <ExceptionList
          items={viewModel.historyItems}
          emptyMessage="No approval history is available for this record."
        />
      </div>
    </Stack>
  );
}
