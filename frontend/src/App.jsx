import { useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  Activity,
  Bell,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  Pause,
  Play,
  Rocket,
  Settings as SettingsIcon,
  Smartphone,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
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

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/creative", label: "Creative studio", icon: Sparkles },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/runs", label: "Publishing runs", icon: Rocket },
  { to: "/settings", label: "Studio settings", icon: SettingsIcon },
];

export default function App() {
  const [authState, setAuthState] = useState(null);
  const [health, setHealth] = useState(null);
  const [bump, setBump] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem("studio-theme-v2") || "dark");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
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
  const operatorName = authState.user?.username || "Administrator";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      {/* Backdrop for the mobile drawer. */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        open={navOpen}
        onNavigate={() => setNavOpen(false)}
        connected={connected}
        health={health}
        paused={paused}
        onTogglePause={togglePause}
      />

      {/* The `main` class is retained so the legacy page stylesheet keeps its
       * padding and `.panel + .panel` spacing. Crucially this element is NOT
       * `.ui` -- the eight unmigrated pages render inside it and still need
       * styles.css element rules to apply. */}
      <main className={`main ${studio ? "main-studio" : ""}`}>
        <div className="ui mb-8 flex min-h-9 items-center justify-between gap-4 border-b pb-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <div className="flex items-center gap-2.5">
              <span className="h-px w-5 bg-primary" aria-hidden="true" />
              <span className="text-xs font-semibold text-muted-foreground">
                Editorial operations
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={`Use ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>

            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={openNotifications}
                title="Notifications"
                aria-label="Notifications"
              >
                <Bell />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground ring-2 ring-background">
                    {Math.min(unread, 9)}
                  </span>
                )}
              </Button>
              {notificationsOpen && (
                <NotificationPanel events={events} onClose={() => setNotificationsOpen(false)} />
              )}
            </div>

            {/* Tailwind v4 puts the important modifier at the end; the
             * separator's own data-[orientation=vertical]:h-full would
             * otherwise collapse to zero inside this flex row. */}
            <Separator orientation="vertical" className="mx-1 h-6!" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  {operatorName}
                  <span className="grid size-7 place-items-center rounded-full border bg-card text-[10px] font-bold text-foreground">
                    PS
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{operatorName}</div>
                  <div className="text-xs text-muted-foreground">Local administrator</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

function Sidebar({ open, onNavigate, connected, health, paused, onTogglePause }) {
  return (
    <nav
      className={cn(
        "ui fixed inset-y-0 left-0 z-40 flex h-screen w-[264px] flex-col overflow-y-auto border-r bg-card px-3 py-5 transition-transform duration-200",
        "lg:sticky lg:top-0 lg:z-20 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex items-center gap-3 px-2 pb-7">
        <div className="grid size-9 flex-none place-items-center rounded-[2px_2px_12px_2px] bg-primary font-serif text-xl font-semibold text-primary-foreground">
          P
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-tight">Publish Studio</div>
          <div className="text-[11px] text-muted-foreground">Your editorial workspace</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto lg:hidden"
          onClick={onNavigate}
          aria-label="Close navigation"
        >
          <X />
        </Button>
      </div>

      <div className="px-3 pb-2 text-[10px] font-bold tracking-[0.13em] text-muted-foreground uppercase">
        Workspace
      </div>

      <div className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onNavigate}
            title={label}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary-ink"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )
            }
          >
            <Icon className="size-[18px]" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>

      <div className="mt-auto pt-6">
        <div className="rounded-xl border bg-muted/40 p-3.5">
          <div className="text-xs font-semibold">Studio status</div>
          <div className="mt-3 grid gap-2">
            <StatusLine
              icon={Activity}
              ok={connected}
              label={connected ? "Live connection" : "Reconnecting"}
            />
            <StatusLine
              icon={Smartphone}
              ok={health?.adb_available}
              label={health?.adb_available ? "Device bridge ready" : "Simulator mode"}
            />
            <StatusLine
              icon={Sparkles}
              ok={(health?.providers_configured ?? 0) > 0}
              label={`${health?.providers_configured ?? 0} provider${
                health?.providers_configured === 1 ? "" : "s"
              } connected`}
            />
          </div>
          <Button
            variant={paused ? "default" : "outline"}
            size="sm"
            className="mt-3.5 w-full"
            onClick={onTogglePause}
            disabled={!health}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? "Resume publishing" : "Pause publishing"}
          </Button>
        </div>
      </div>
    </nav>
  );
}

function StatusLine({ icon: Icon, ok, label }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <Icon className={cn("size-3.5", ok ? "text-success-ink" : "text-warning-ink")} />
      {label}
    </div>
  );
}

function NotificationPanel({ events, onClose }) {
  const items = [...events].reverse().slice(0, 20);
  return (
    <div className="absolute top-11 right-0 z-40 w-[min(390px,calc(100vw-32px))] overflow-hidden rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Notifications</div>
          <div className="text-xs text-muted-foreground">Live studio activity</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mt-3 max-h-[420px] overflow-y-auto">
        {!items.length && (
          <div className="py-8 text-center text-xs text-muted-foreground">No new activity.</div>
        )}
        {items.map((event, index) => (
          <div
            className="grid grid-cols-[8px_1fr_auto] items-start gap-2.5 border-t py-2.5"
            key={`${event.kind}-${event.at}-${index}`}
          >
            <span
              className={cn(
                "mt-1.5 size-2 rounded-full",
                notificationTone(event.kind)
              )}
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold capitalize">
                {event.kind.replaceAll(".", " ")}
              </div>
              <div className="text-xs break-words text-muted-foreground">
                {notificationSummary(event)}
              </div>
            </div>
            <time className="text-[9px] text-muted-foreground">
              {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
        ))}
      </div>
    </div>
  );
}

function notificationTone(kind) {
  if (kind.includes("failed") || kind.includes("error")) return "bg-destructive";
  if (kind.includes("finished") || kind.includes("approved") || kind.includes("ready"))
    return "bg-success";
  return "bg-primary";
}

function notificationSummary(event) {
  return event.note || event.error || event.title || event.outcome || event.detail || "Studio activity updated";
}
