import Chip from "@mui/material/Chip";

type StatusTone = "critical" | "warning" | "success" | "neutral" | "info";

interface StatusChipProps {
  label: string;
  tone?: StatusTone;
}

const CHIP_COLOR_MAP: Record<StatusTone, "error" | "warning" | "success" | "default" | "info"> = {
  critical: "error",
  warning: "warning",
  success: "success",
  neutral: "default",
  info: "info",
};

export function StatusChip({ label, tone = "neutral" }: StatusChipProps) {
  return <Chip label={label} color={CHIP_COLOR_MAP[tone]} size="small" variant="filled" />;
}
