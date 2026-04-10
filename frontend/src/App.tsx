import { NavLink, Route, Routes } from "react-router-dom";
import { CoDashboardPage } from "./pages/CoDashboardPage";
import { DashboardIndex } from "./pages/DashboardIndex";
import { Dashboard } from "./pages/Dashboard";
import { FailedEvents } from "./pages/FailedEvents";
import { FsgDashboardPage } from "./pages/FsgDashboardPage";
import { LogComdDashboardPage } from "./pages/LogComdDashboardPage";
import { MeoDashboardPage } from "./pages/MeoDashboardPage";
import { RecordDetailPage } from "./pages/RecordDetailPage";
import { ShipView } from "./pages/ShipView";
import { WeoDashboardPage } from "./pages/WeoDashboardPage";

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
            to="/dashboards"
            className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
          >
            Role Dashboards
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
          <Route path="/dashboards" element={<DashboardIndex />} />
          <Route path="/dashboards/co" element={<CoDashboardPage />} />
          <Route path="/dashboards/meo" element={<MeoDashboardPage />} />
          <Route path="/dashboards/weo" element={<WeoDashboardPage />} />
          <Route path="/dashboards/fsg" element={<FsgDashboardPage />} />
          <Route path="/dashboards/log-comd" element={<LogComdDashboardPage />} />
          <Route path="/ship/:shipId" element={<ShipView />} />
          <Route path="/records/:recordId" element={<RecordDetailPage />} />
          <Route path="/failed" element={<FailedEvents />} />
        </Routes>
      </main>
    </div>
  );
}
