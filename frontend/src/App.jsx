import { useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api, useEvents } from "./api.js";
import Dashboard from "./pages/Dashboard.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import CampaignDetail from "./pages/CampaignDetail.jsx";
import Calendar from "./pages/Calendar.jsx";
import Runs from "./pages/Runs.jsx";
import RunDetail from "./pages/RunDetail.jsx";
import Settings from "./pages/Settings.jsx";
import CreativeLab from "./pages/CreativeLab.jsx";
import AuthScreen from "./AuthScreen.jsx";

const NAV = [
  ["/", "Dashboard", "home"],
  ["/campaigns", "Campaigns", "campaigns"],
  ["/creative", "Creative studio", "creative"],
  ["/calendar", "Calendar", "calendar"],
  ["/runs", "Publishing runs", "runs"],
  ["/settings", "Studio settings", "settings"],
];

function NavIcon({ name }) {
  const paths = {
    home: <><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6"/></>,
    campaigns: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M8 5V3m8 2V3M3 10h18m-13 4h3m2 0h3"/></>,
    creative: <><path d="m12 3 1.45 4.55L18 9l-4.55 1.45L12 15l-1.45-4.55L6 9l4.55-1.45L12 3Z"/><path d="m18.5 15 .72 2.28 2.28.72-2.28.72L18.5 22l-.72-2.28L15.5 19l2.28-.72L18.5 15Z"/></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4m8-4v4M3 9h18m-13 4h2m4 0h2m-8 4h2m4 0h2"/></>,
    runs: <><path d="M4 4v16M4 7h10a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h11"/><path d="m17 16 3 3-3 3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.37.36.7.6 1 .27.28.62.42 1 .4h.09v4H21a1.7 1.7 0 0 0-1.6.6Z"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function App() {
  const [authState, setAuthState] = useState(null);
  const [health, setHealth] = useState(null);
  const [bump, setBump] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem("studio-theme-v2") || "dark");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readCount, setReadCount] = useState(0);
  // The creative studio is a workspace, not a page: it takes the whole window.
  const studio = useLocation().pathname.startsWith("/creative");

  // Anything that changes the world re-reads the header, so the paused flag and
  // the queue counts are never stale while a run is in flight.
  const onEvent = useCallback((event) => {
    if (event.kind.startsWith("run.") || event.kind.startsWith("publishing.")) {
      setBump((n) => n + 1);
    }
  }, []);
  const authenticated = Boolean(authState?.authenticated);
  const { events, connected } = useEvents(onEvent, authenticated);

  useEffect(() => {
    api.get("/api/auth/status").then(setAuthState).catch(() => setAuthState({ configured: true, authenticated: false }));
    const expired = () => setAuthState((state) => ({ ...(state || {}), authenticated: false }));
    window.addEventListener("studio-auth-required", expired);
    return () => window.removeEventListener("studio-auth-required", expired);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("studio-theme-v2", theme);
  }, [theme]);

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

  const logout = async () => {
    await api.post("/api/auth/logout", {});
    setAuthState({ configured: true, authenticated: false });
  };

  const openNotifications = () => {
    setNotificationsOpen((open) => !open);
    setReadCount(events.length);
  };

  if (authState === null) {
    return <div className="auth-loading"><div className="brand-mark">P</div><span>Opening studio…</span></div>;
  }

  if (!authenticated) {
    return <AuthScreen configured={authState.configured} onAuthenticated={(result) => setAuthState({ configured: true, ...result })} />;
  }

  const unread = Math.max(0, events.length - readCount);

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div className="brand-copy">
            <b>Publish Studio</b>
            <span>Your editorial workspace</span>
          </div>
        </div>

        <div className="nav-label">Workspace</div>
        <div className="sidebar-nav">
          {NAV.map(([to, label, icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}
              title={label}
            >
              <NavIcon name={icon} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        <div className="sidebar-foot">
          <div className="status-card">
            <div className="status-heading">Studio status</div>
            <div className="status-lines">
              <div className="status-line">
                <span className="dot" style={{ color: connected ? "#6fc293" : "#e68b80" }} />
                {connected ? "Live connection" : "Reconnecting"}
              </div>
              <div className="status-line">
                <span className="dot" style={{ color: health?.adb_available ? "#6fc293" : "#d8aa65" }} />
                {health?.adb_available ? "Device bridge ready" : "Simulator mode"}
              </div>
              <div className="status-line">
                <span className="dot" style={{ color: (health?.providers_configured ?? 0) > 0 ? "#6fc293" : "#d8aa65" }} />
                {health?.providers_configured ?? 0} provider{health?.providers_configured === 1 ? "" : "s"} connected
              </div>
            </div>
            <button className={`${paused ? "primary" : "danger"} publish-toggle`} onClick={togglePause} disabled={!health}>
              {paused ? "Resume publishing" : "Pause publishing"}
            </button>
          </div>
        </div>
      </nav>

      <main className={`main ${studio ? "main-studio" : ""}`}>
        <div className="main-topbar">
          <div className="workspace-name">Editorial operations</div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title={`Use ${theme === "dark" ? "light" : "dark"} mode`}>
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <div className="notification-wrap">
              <button className="icon-button" onClick={openNotifications} title="Notifications" aria-label="Notifications">
                ♢
                {unread > 0 && <span className="notification-count">{Math.min(unread, 9)}</span>}
              </button>
              {notificationsOpen && (
                <NotificationPanel events={events} onClose={() => setNotificationsOpen(false)} />
              )}
            </div>
            <div className="operator">
              {authState.user?.username || "Administrator"}
              <button className="operator-mark" onClick={logout} title="Sign out">PS</button>
            </div>
          </div>
        </div>
        {paused && (
          <div className="banner warn">
            Publishing is paused. Nothing new will be dispatched until you resume.
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard events={events} bump={bump} />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetail bump={bump} />} />
          <Route path="/creative" element={<CreativeLab />} />
          <Route path="/calendar" element={<Calendar bump={bump} />} />
          <Route path="/runs" element={<Runs bump={bump} />} />
          <Route path="/runs/:id" element={<RunDetail bump={bump} />} />
          <Route path="/settings" element={<Settings user={authState.user} />} />
        </Routes>
      </main>
    </div>
  );
}

function NotificationPanel({ events, onClose }) {
  const items = [...events].reverse().slice(0, 20);
  return (
    <div className="notification-panel">
      <div className="spread">
        <div>
          <h3>Notifications</h3>
          <div className="small muted">Live studio activity</div>
        </div>
        <button className="ghost small" onClick={onClose}>Close</button>
      </div>
      <div className="notification-list">
        {!items.length && <div className="empty">No new activity.</div>}
        {items.map((event, index) => (
          <div className="notification-item" key={`${event.kind}-${event.at}-${index}`}>
            <span className={`notification-dot ${notificationKind(event.kind)}`} />
            <div>
              <b>{event.kind.replaceAll(".", " ")}</b>
              <div className="small muted">{notificationSummary(event)}</div>
            </div>
            <time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          </div>
        ))}
      </div>
    </div>
  );
}

function notificationKind(kind) {
  if (kind.includes("failed") || kind.includes("error")) return "bad";
  if (kind.includes("finished") || kind.includes("approved") || kind.includes("ready")) return "ok";
  return "info";
}

function notificationSummary(event) {
  return event.note || event.error || event.title || event.outcome || event.detail || "Studio activity updated";
}
