import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(status, detail, body) {
    super(detail);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = { detail: await res.text() };
    }
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new CustomEvent("studio-auth-required"));
    }
    throw new ApiError(res.status, payload.detail || res.statusText, payload);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function formRequest(path, body) {
  const res = await fetch(path, { method: "POST", credentials: "same-origin", body });
  if (!res.ok) {
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = { detail: await res.text() };
    }
    if (res.status === 401) window.dispatchEvent(new CustomEvent("studio-auth-required"));
    throw new ApiError(res.status, payload.detail || res.statusText, payload);
  }
  return res.json();
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  patch: (p, b) => request("PATCH", p, b),
  put: (p, b) => request("PUT", p, b),
  del: (p) => request("DELETE", p),
  form: (p, b) => formRequest(p, b),
};

/** Load once, expose a reload. `deps` re-fetches when they change. */
export function useResource(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api.get(path));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);

  return { data, error, loading, reload, setData };
}

/**
 * The live run feed. Steps arrive while a phone is being driven, which is the
 * whole point of watching a publish rather than waiting for a result.
 */
export function useEvents(onEvent, enabled = true) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setEvents([]);
      return undefined;
    }
    let socket;
    let retry;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${location.host}/api/events`);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (msg) => {
        const event = JSON.parse(msg.data);
        if (event.kind === "ping") return;
        setEvents((prev) => [...prev.slice(-400), { ...event, at: Date.now() }]);
        handler.current?.(event);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [enabled]);

  return { events, connected };
}
