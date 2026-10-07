import { useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, useEvents } from "./api.js";
import Dashboard from "./pages/Dashboard.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import CampaignDetail from "./pages/CampaignDetail.jsx";
import Calendar from "./pages/Calendar.jsx";
import Runs from "./pages/Runs.jsx";
import RunDetail from "./pages/RunDetail.jsx";
import Settings from "./pages/Settings.jsx";

const NAV = [
  ["/", "Dashboard"],
  ["/campaigns", "Campaigns"],
  ["/calendar", "Calendar"],
  ["/runs", "Runs"],
  ["/settings", "Settings"],
];

export default function App() {
  const [health, setHealth] = useState(null);
  const [bump, setBump] = useState(0);

  // Anything that changes the world re-reads the header, so the paused flag and
  // the queue counts are never stale while a run is in flight.
  const onEvent = useCallback((event) => {
    if (event.kind.startsWith("run.") || event.kind.startsWith("publishing.")) {
      setBump((n) => n + 1);
    }
  }, []);
  const { events, connected } = useEvents(onEvent);

  const reloadHealth = useCallback(async () => {
    try {
      setHealth(await api.get("/api/health"));
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    reloadHealth();
  }, [reloadHealth, bump]);

  const paused = health?.scheduler?.paused;

  const togglePause = async () => {
    await api.post("/api/scheduler/pause", {
      paused: !paused,
      reason: paused ? "" : "stopped from the console",
    });
    reloadHealth();
  };

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <b>AI Publishing Studio</b>
          <span>brief in, approved posts out</span>
        </div>

        {NAV.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}
          >
            {label}
          </NavLink>
        ))}

        <div style={{ marginTop: "auto" }} className="stack">
          <button className={paused ? "primary" : "danger"} onClick={togglePause} disabled={!health}>
            {paused ? "Resume publishing" : "Stop all publishing"}
          </button>
          <div className="small muted">
            <div className="row" style={{ gap: 6 }}>
              <span className="dot" style={{ color: connected ? "var(--ok)" : "var(--bad)" }} />
              {connected ? "live" : "reconnecting"}
            </div>
            <div>{health?.adb_available ? "adb ready" : "adb not installed — simulator only"}</div>
            <div>{health?.providers_configured ?? 0} real provider(s) configured</div>
          </div>
        </div>
      </nav>

      <main className="main">
        {paused && (
          <div className="banner warn">
            Publishing is paused. Nothing new will be dispatched until you resume.
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard events={events} bump={bump} />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetail bump={bump} />} />
          <Route path="/calendar" element={<Calendar bump={bump} />} />
          <Route path="/runs" element={<Runs bump={bump} />} />
          <Route path="/runs/:id" element={<RunDetail bump={bump} />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
