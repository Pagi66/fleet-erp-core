import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";
import {
  DASHBOARD_ROLE_DEFINITIONS,
  type DashboardRole,
} from "../../types/roles";

interface DashboardShellProps {
  role: DashboardRole;
  title: string;
  subtitle: string;
  shipSelector?: ReactNode;
  kpis: ReactNode;
  primary: ReactNode;
  secondary: ReactNode;
}

export function DashboardShell({
  role,
  title,
  subtitle,
  shipSelector,
  kpis,
  primary,
  secondary,
}: DashboardShellProps) {
  return (
    <Stack spacing={3}>
      <Paper
        elevation={0}
        sx={{
          p: 3,
          border: "1px solid",
          borderColor: "divider",
          background:
            "linear-gradient(135deg, rgba(31,58,95,0.08), rgba(75,107,138,0.04))",
        }}
      >
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
            spacing={2}
          >
            <Box>
              <Typography variant="overline" color="text.secondary">
                Role Dashboard
              </Typography>
              <Typography variant="h4">{title}</Typography>
              <Typography color="text.secondary">{subtitle}</Typography>
            </Box>
            {shipSelector}
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {DASHBOARD_ROLE_DEFINITIONS.map((definition) => (
              <Button
                key={definition.role}
                component={RouterLink}
                to={definition.route}
                variant={definition.role === role ? "contained" : "outlined"}
                color={definition.role === role ? "primary" : "inherit"}
              >
                {definition.shortLabel}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Paper>

      {kpis}

      <Stack direction={{ xs: "column", xl: "row" }} spacing={3} alignItems="stretch">
        <Box sx={{ flex: 2, minWidth: 0 }}>{primary}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>{secondary}</Box>
      </Stack>
    </Stack>
  );
}
