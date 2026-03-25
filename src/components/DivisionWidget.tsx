"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Settings {
  colA?: any;
  colB?: any;
  suffix?: string;
  decimals?: string;
  unit?: any;
}

// Monday passes board_columns as: { "boardId": ["columnId"] }
function extractColId(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") return val || null;
  if (val.id) return val.id;
  if (val.value) return val.value;
  // { "boardId": ["colId", ...] }
  for (const boardId of Object.keys(val)) {
    const cols = val[boardId];
    if (Array.isArray(cols) && cols.length > 0) return cols[0];
    if (typeof cols === "object" && cols !== null) {
      for (const colId of Object.keys(cols)) {
        if (cols[colId] === true) return colId;
      }
    }
  }
  return null;
}

// Monday unit field: { symbol, direction, custom_unit }
function extractSuffix(settings: Settings): string {
  if (settings.suffix) return settings.suffix;
  if (settings.unit && typeof settings.unit === "object") {
    return settings.unit.custom_unit || settings.unit.symbol || "";
  }
  return "";
}

export default function DivisionWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [result, setResult] = useState<number | null>(null);
  const [phase, setPhase] = useState<"init" | "no-settings" | "loading" | "ready" | "error">("init");
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    import("monday-sdk-js").then((mod) => {
      const sdk = (mod.default as any)();
      setMonday(sdk);

      sdk.get("context").then((res: any) => {
        if (!isMounted.current) return;
        const d = res?.data;
        const id = d?.boardId?.toString() || d?.boardIds?.[0]?.toString() || d?.connectedBoards?.[0]?.boardId?.toString() || null;
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

  const fetchAndCalc = useCallback(async (sdk: any, bid: string, cfg: Settings) => {
    const colA = extractColId(cfg.colA);
    const colB = extractColId(cfg.colB);

    if (!colA || !colB) { setPhase("no-settings"); return; }

    setPhase("loading");
    try {
      const colIds = `"${colA}", "${colB}"`;
      const all: any[] = [];
      let cursor: string | null = null;

      do {
        const q: string = cursor
          ? `{ boards(ids:[${bid}]) { items_page(limit:100, cursor:"${cursor}") { cursor items { column_values(ids:[${colIds}]) { id text } } } } }`
          : `{ boards(ids:[${bid}]) { items_page(limit:100) { cursor items { column_values(ids:[${colIds}]) { id text } } } } }`;
        const r = await sdk.api(q);
        const page = r?.data?.boards?.[0]?.items_page;
        if (!page) break;
        all.push(...(page.items || []));
        cursor = page.cursor || null;
      } while (cursor);

      let sumA = 0, sumB = 0;
      all.forEach((item) => {
        (item.column_values || []).forEach((cv: any) => {
          const val = parseFloat(cv.text || "0") || 0;
          if (cv.id === colA) sumA += val;
          if (cv.id === colB) sumB += val;
        });
      });

      const res = sumB > 0 ? sumA / sumB : 0;
      if (isMounted.current) { setResult(res); setPhase("ready"); }
    } catch (e: any) {
      if (isMounted.current) { setPhase("error"); }
    }
  }, []);

  useEffect(() => {
    if (monday && boardId) fetchAndCalc(monday, boardId, settings);
  }, [monday, boardId, settings, fetchAndCalc]);

  const openSettings = () => { if (monday) monday.execute("openSettings"); };
  const decimals = Math.min(Math.max(parseInt(settings.decimals || "2", 10), 0), 4);
  const suffix = extractSuffix(settings);
  const formatted = result !== null ? result.toFixed(decimals) : null;

  if (phase === "init" || phase === "loading") {
    return (
      <div style={s.root}>
        <span style={{ ...s.bigNum, opacity: 0.2 }}>—</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (phase === "no-settings") {
    return (
      <div style={s.root}>
        <p style={s.emptyText}>Configura el widget</p>
        <button style={s.btn} onClick={openSettings}>Ajustes</button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={s.root}>
        <p style={{ color: "#e2445c", fontSize: 13 }}>Error al cargar</p>
      </div>
    );
  }

  return (
    <div style={s.root}>
      <div style={s.numRow}>
        <span style={s.bigNum}>{formatted}</span>
        {suffix && <span style={s.suffix}>{suffix}</span>}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    width: "100%", height: "100%", minHeight: 100,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    fontFamily: "Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "8px 12px", boxSizing: "border-box",
  },
  numRow: { display: "flex", alignItems: "baseline", justifyContent: "center" },
  bigNum: {
    fontSize: "clamp(48px, 11vw, 80px)", fontWeight: 300, color: "#323338",
    letterSpacing: "-0.02em", lineHeight: 1,
  },
  suffix: {
    fontSize: "clamp(24px, 5vw, 40px)", fontWeight: 300, color: "#323338",
    lineHeight: 1, marginLeft: "0.1em",
  },
  emptyText: { fontSize: 13, color: "#676879", margin: "0 0 10px" },
  btn: { padding: "5px 14px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 },
};
