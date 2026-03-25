"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Settings {
  colA?: string;
  colB?: string;
  suffix?: string;
  decimals?: string;
  title?: string;
}

function formatNumber(n: number, decimals: number, suffix: string): string {
  const fixed = n.toFixed(decimals);
  return suffix ? `${fixed}${suffix}` : fixed;
}

export default function DivisionWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [result, setResult] = useState<number | null>(null);
  const [phase, setPhase] = useState<"init" | "no-settings" | "loading" | "ready" | "error">("init");
  const [error, setError] = useState("");
  const isMounted = useRef(true);

  // 1. Init SDK
  useEffect(() => {
    isMounted.current = true;
    import("monday-sdk-js").then((mod) => {
      const sdk = (mod.default as any)();
      setMonday(sdk);

      sdk.get("context").then((res: any) => {
        if (!isMounted.current) return;
        const data = res?.data;
        const id =
          data?.boardId?.toString() ||
          data?.boardIds?.[0]?.toString() ||
          data?.connectedBoards?.[0]?.boardId?.toString() ||
          null;
        setBoardId(id);
      });

      sdk.get("settings").then((res: any) => {
        if (!isMounted.current) return;
        setSettings(res?.data || {});
      });

      sdk.listen("settings", (res: any) => {
        if (!isMounted.current) return;
        setSettings(res?.data || {});
      });
    });
    return () => { isMounted.current = false; };
  }, []);

  // 2. Fetch and calculate
  const fetchAndCalc = useCallback(async (sdk: any, bid: string, cfg: Settings) => {
    if (!cfg.colA || !cfg.colB) {
      setPhase("no-settings");
      return;
    }
    setPhase("loading");
    try {
      const colIds = `"${cfg.colA}", "${cfg.colB}"`;
      const allItems: any[] = [];
      let cursor: string | null = null;

      do {
        const query: string = cursor
          ? `{ boards(ids:[${bid}]) { items_page(limit:100, cursor:"${cursor}") { cursor items { column_values(ids:[${colIds}]) { id text } } } } }`
          : `{ boards(ids:[${bid}]) { items_page(limit:100) { cursor items { column_values(ids:[${colIds}]) { id text } } } } }`;
        const res = await sdk.api(query);
        const page = res?.data?.boards?.[0]?.items_page;
        if (!page) break;
        allItems.push(...(page.items || []));
        cursor = page.cursor || null;
      } while (cursor);

      let sumA = 0, sumB = 0;
      allItems.forEach((item) => {
        (item.column_values || []).forEach((cv: any) => {
          const val = parseFloat(cv.text || "0") || 0;
          if (cv.id === cfg.colA) sumA += val;
          if (cv.id === cfg.colB) sumB += val;
        });
      });

      const res = sumB > 0 ? sumA / sumB : 0;
      if (isMounted.current) { setResult(res); setPhase("ready"); }
    } catch (e: any) {
      if (isMounted.current) { setError(e?.message || "Error"); setPhase("error"); }
    }
  }, []);

  useEffect(() => {
    if (monday && boardId) fetchAndCalc(monday, boardId, settings);
  }, [monday, boardId, settings, fetchAndCalc]);

  const openSettings = () => { if (monday) monday.execute("openSettings"); };

  const decimals = parseInt(settings.decimals || "2", 10);
  const suffix = settings.suffix || "";
  const title = settings.title || "División";

  // ── Renders — identical to Monday number widget ──

  if (phase === "init" || phase === "loading") {
    return (
      <div style={s.root}>
        <div style={s.spinner} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (phase === "no-settings") {
    return (
      <div style={s.root}>
        <div style={s.emptyWrap}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c3c6d4" strokeWidth="1.5" style={{ marginBottom: 10 }}>
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            <circle cx="12" cy="5" r="1" fill="#c3c6d4" /><circle cx="12" cy="19" r="1" fill="#c3c6d4" />
          </svg>
          <p style={s.emptyTitle}>Selecciona las columnas</p>
          <p style={s.emptySub}>Configura el numerador y denominador desde el panel de ajustes.</p>
          <button style={s.openBtn} onClick={openSettings}>Configurar</button>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={s.root}>
        <p style={{ color: "#e2445c", fontSize: 13, textAlign: "center" }}>⚠ {error}</p>
      </div>
    );
  }

  // Ready — Monday number widget look
  return (
    <div style={s.root}>
      {/* Title — same as Monday widget header */}
      <div style={s.widgetTitle}>{title}</div>

      {/* Big number — same size/weight as Monday native */}
      <div style={s.numberWrap}>
        <span style={s.bigNumber}>
          {formatNumber(result ?? 0, decimals, suffix)}
        </span>
      </div>

      {/* Subtitle: formula explanation */}
      <div style={s.formula}>
        SUM(A) ÷ SUM(B)
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: "100%",
    height: "100%",
    minHeight: 120,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    padding: "16px 20px",
    boxSizing: "border-box",
  },
  spinner: {
    width: 28,
    height: 28,
    border: "3px solid #e6e9ef",
    borderTop: "3px solid #0073ea",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  emptyWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    maxWidth: 220,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#323338",
    margin: "0 0 6px",
  },
  emptySub: {
    fontSize: 12,
    color: "#676879",
    margin: "0 0 14px",
    lineHeight: 1.5,
  },
  openBtn: {
    padding: "6px 18px",
    background: "#0073ea",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  },
  widgetTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: "#323338",
    marginBottom: 8,
    textAlign: "center",
    width: "100%",
  },
  numberWrap: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "center",
    width: "100%",
  },
  // Monday's native number widget uses ~60-80px font, weight 300-400
  bigNumber: {
    fontSize: "clamp(40px, 8vw, 72px)",
    fontWeight: 300,
    color: "#323338",
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
    textAlign: "center",
  },
  formula: {
    marginTop: 8,
    fontSize: 11,
    color: "#c3c6d4",
    textAlign: "center",
  },
};
