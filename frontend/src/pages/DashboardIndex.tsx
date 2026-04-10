import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";
import { DASHBOARD_ROLE_DEFINITIONS } from "../types/roles";

export function DashboardIndex() {
  return (
    <Stack spacing={3}>
      <div>
        <Typography variant="overline" color="text.secondary">
          Fleet ERP Dashboards
        </Typography>
        <Typography variant="h3">Role Dashboard Index</Typography>
        <Typography color="text.secondary">
          Launch the read-only v1 dashboards for command, engineering, support, and logistics roles.
        </Typography>
      </div>

      <Grid container spacing={2}>
        {DASHBOARD_ROLE_DEFINITIONS.map((definition) => (
          <Grid key={definition.role} size={{ xs: 12, md: 6, xl: 4 }}>
            <Card elevation={0} sx={{ border: "1px solid", borderColor: "divider", height: "100%" }}>
              <CardContent>
                <Stack spacing={1.5}>
                  <Typography variant="h5">{definition.label}</Typography>
                  <Typography color="text.secondary">{definition.subtitle}</Typography>
                </Stack>
              </CardContent>
              <CardActions>
                <Button component={RouterLink} to={definition.route} variant="contained">
                  Open Dashboard
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
