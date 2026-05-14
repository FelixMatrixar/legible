import { create } from "zustand";
import type { BatchDetail, BatchListItem, LiveEvent, PageReport } from "./types";

// Empty by default: local dev goes through Vite's /api proxy (same-origin).
// Set VITE_API_URL when the dashboard is deployed separately from the API
// (e.g. Render static site + Render web service on different domains).
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

// Single-operator auth: the API key is pasted once and kept in localStorage —
// never baked into the built bundle.
export const getApiKey = (): string => localStorage.getItem("legible-api-key") ?? "";
export const saveApiKey = (key: string): void => {
  localStorage.setItem("legible-api-key", key.trim());
  location.reload();
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { "x-api-key": getApiKey() } });
  if (res.status === 401 || res.status === 503) throw new Error("unauthorized");
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

interface DashboardState {
  batches: BatchListItem[];
  selectedBatchId: string | null;
  batchDetail: BatchDetail | null;
  pageReport: PageReport | null;
  liveEvents: LiveEvent[];
  wsConnected: boolean;
  unauthorized: boolean;

  loadBatches: () => Promise<void>;
  selectBatch: (id: string) => Promise<void>;
  openPage: (pageId: string) => Promise<void>;
  closePage: () => void;
  applyLiveEvents: (events: LiveEvent[]) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useDashboard = create<DashboardState>((set, get) => ({
  batches: [],
  selectedBatchId: null,
  batchDetail: null,
  pageReport: null,
  liveEvents: [],
  wsConnected: false,
  unauthorized: false,

  loadBatches: async () => {
    try {
      const { batches } = await api<{ batches: BatchListItem[] }>("/api/batches");
      set({ batches, unauthorized: false });
      if (!get().selectedBatchId && batches.length > 0) {
        void get().selectBatch(batches[0].id);
      }
    } catch (err) {
      if (err instanceof Error && err.message === "unauthorized") set({ unauthorized: true });
      else throw err;
    }
  },

  selectBatch: async (id) => {
    set({ selectedBatchId: id, pageReport: null });
    const detail = await api<BatchDetail>(`/api/batches/${id}`);
    set({ batchDetail: detail });
  },

  openPage: async (pageId) => {
    set({ pageReport: await api<PageReport>(`/api/pages/${pageId}`) });
  },

  closePage: () => set({ pageReport: null }),

  applyLiveEvents: (events) => {
    set((s) => ({ liveEvents: [...events.reverse(), ...s.liveEvents].slice(0, 50) }));
    const current = get().selectedBatchId;
    // Refresh the open batch when one of its pages advances a stage.
    if (current && events.some((e) => e.batchId === current)) {
      void get().selectBatch(current);
    }
    if (events.some((e) => e.type === "batch-submitted" || e.type === "batch-complete")) {
      void get().loadBatches();
    }
  },

  setWsConnected: (wsConnected) => set({ wsConnected }),
}));
