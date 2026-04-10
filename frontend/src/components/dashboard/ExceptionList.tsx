import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export interface ExceptionListItem {
  key: string;
  primary: string;
  secondary: string;
  meta?: string;
  adornment?: ReactNode;
}

interface ExceptionListProps {
  items: ExceptionListItem[];
  emptyMessage: string;
}

export function ExceptionList({ items, emptyMessage }: ExceptionListProps) {
  if (items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography color="text.secondary">{emptyMessage}</Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined">
      <List disablePadding>
        {items.map((item, index) => (
          <ListItem
            key={item.key}
            divider={index < items.length - 1}
            secondaryAction={item.adornment}
          >
            <ListItemText
              primary={item.primary}
              secondary={
                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    {item.secondary}
                  </Typography>
                  {item.meta ? (
                    <Typography variant="caption" color="text.secondary">
                      {item.meta}
                    </Typography>
                  ) : null}
                </Stack>
              }
            />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
