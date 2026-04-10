import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1f3a5f",
    },
    secondary: {
      main: "#4b6b8a",
    },
    error: {
      main: "#a63a2f",
    },
    warning: {
      main: "#b67a12",
    },
    success: {
      main: "#2c6b4f",
    },
    background: {
      default: "#f2f5f8",
      paper: "#ffffff",
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    h1: {
      fontSize: "2rem",
      fontWeight: 700,
    },
    h2: {
      fontSize: "1.375rem",
      fontWeight: 700,
    },
    button: {
      fontWeight: 600,
      textTransform: "none",
    },
  },
});
