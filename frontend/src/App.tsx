import { NavLink, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { FailedEvents } from "./pages/FailedEvents";
import { ShipView } from "./pages/ShipView";

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Fleet ERP</p>
          <h1>Operations Dashboard</h1>
        </div>
        <nav className="nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/failed"
            className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
          >
            Failed Events
          </NavLink>
        </nav>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ship/:shipId" element={<ShipView />} />
          <Route path="/failed" element={<FailedEvents />} />
        </Routes>
      </main>
    </div>
  );
}
