import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";

export interface ShipOption {
  value: string;
  label: string;
}

interface ShipSelectorProps {
  shipId: string;
  options: ShipOption[];
  label?: string;
  onChange: (shipId: string) => void;
}

export function ShipSelector({
  shipId,
  options,
  label = "Ship",
  onChange,
}: ShipSelectorProps) {
  return (
    <FormControl size="small" sx={{ minWidth: 220 }}>
      <InputLabel id="ship-selector-label">{label}</InputLabel>
      <Select
        labelId="ship-selector-label"
        value={shipId}
        label={label}
        onChange={(event) => onChange(event.target.value)}
      >
        <MenuItem value="">
          <em>Select ship</em>
        </MenuItem>
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
