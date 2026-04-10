import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { StatusChip } from "./StatusChip";

export interface KpiCardItem {
  label: string;
  value: string | number;
  helper?: string;
  tone?: "critical" | "warning" | "success" | "neutral" | "info";
}

interface KpiCardGridProps {
  items: KpiCardItem[];
}

export function KpiCardGrid({ items }: KpiCardGridProps) {
  return (
    <Grid container spacing={2}>
      {items.map((item) => (
        <Grid key={item.label} size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card elevation={0} sx={{ border: "1px solid", borderColor: "divider", height: "100%" }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    {item.label}
                  </Typography>
                  {item.tone ? <StatusChip label={item.tone.toUpperCase()} tone={item.tone} /> : null}
                </Stack>
                <Typography variant="h4">{item.value}</Typography>
                {item.helper ? (
                  <Typography variant="body2" color="text.secondary">
                    {item.helper}
                  </Typography>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
