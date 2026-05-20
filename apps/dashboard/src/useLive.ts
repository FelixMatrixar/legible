import { useEffect } from "react";
import { API_BASE, getApiKey } from "./store";
import { useDashboard } from "./store";
import type { LiveEvent } from "./types";

function wsUrl(): string {
  // Browsers can't set headers on WebSocket connects, so the operator key
  // rides as a query param; the server checks it on connection.
  const key = `/ws?key=${encodeURIComponent(getApiKey())}`;
  if (API_BASE) {
    // API_BASE is an http(s) origin (e.g. https://legible-api.onrender.com) —
    // swap the scheme for its ws(s) equivalent.
    return `${API_BASE.replace(/^http/, "ws")}${key}`;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${key}`;
}

/** WebSocket connection to the API's live tail, with auto-reconnect. */
export function useLive(): void {
  const applyLiveEvents = useDashboard((s) => s.applyLiveEvents);
  const setWsConnected = useDashboard((s) => s.setWsConnected);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => setWsConnected(true);
      socket.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data as string) as { type: string; events?: LiveEvent[] };
          if (frame.type === "live-events" && frame.events) applyLiveEvents(frame.events);
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        setWsConnected(false);
        if (!disposed) retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [applyLiveEvents, setWsConnected]);
}
