"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Settings {
  colA?: any; colB?: any;
  suffix?: string; decimals?: string;
  unit?: any; multiplyBy100?: any;
}

function extractColId(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") return val || null;
  if (val.id) return val.id;
  if (val.value) return val.value;
  for (const k of Object.keys(val)) {
    const v = val[k];
    if (Array.isArray(v) && v.length > 0) return v[0];
    if (typeof v === "object" && v !== null) {
      for (const c of Object.keys(v)) { if (v[c] === true) return c; }
    }
  }
  return null;
}

function extractSuffix(s: Settings): string {
  if (s.suffix) return s.suffix;
  if (s.unit && typeof s.unit === "object") return s.unit.custom_unit || s.unit.symbol || "";
  return "";
}

function extractBool(val: any): boolean {
  if (!val) return false;
  if (val === true || val === "true" || val === 1 || val === "1") return true;
  if (typeof val === "object") return Object.values(val).some((v) => v === true || v === "true" || v === 1);
  return false;
}

export default function DivisionWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [result, setResult] = useState<number | null>(null);
  const [phase, setPhase] = useState<"init" | "no-settings" | "loading" | "ready" | "error">("init");
  const [isDark, setIsDark] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    import("monday-sdk-js").then((mod) => {
      const sdk = (mod.default as any)();
      setMonday(sdk);
      sdk.get("context").then((res: any) => {
        if (!isMounted.current) return;
        const d = res?.data;
        setIsDark((d?.theme || "light") === "dark" || d?.theme === "black");

        // If Monday is exporting to PDF, redirect to static server-side render
        if (d?.isExporting) {
          const s = d?.settings || {};
          const colA = extractColId(s?.colA);
          const colB = extractColId(s?.colB);
          const bid = d?.boardId?.toString() || d?.boardIds?.[0]?.toString() || "";
          if (colA && colB && bid) {
            const suffix = extractSuffix(s);
            const decimals = Math.min(Math.max(parseInt(s?.decimals || "2", 10), 0), 4);
            const multiply = extractBool(s?.multiplyBy100);
            const dark = (d?.theme || "light") === "dark" || d?.theme === "black";
            const params = new URLSearchParams({ boardId: bid, colA, colB, suffix, decimals: decimals.toString(), multiply: multiply ? "1" : "0", dark: dark ? "1" : "0" });
            window.location.href = `/api/division-static?${params}`;
            return;
          }
        }

        const id = d?.boardId?.toString() || d?.boardIds?.[0]?.toString() || d?.connectedBoards?.[0]?.boardId?.toString() || null;
        setBoardId(id);
      });
      sdk.listen("context", (res: any) => {
        if (!isMounted.current) return;
        setIsDark((res?.data?.theme || "light") === "dark" || res?.data?.theme === "black");
      });
      sdk.get("settings").then((res: any) => { if (isMounted.current) setSettings(res?.data || {}); });
      sdk.listen("settings", (res: any) => { if (isMounted.current) setSettings(res?.data || {}); });
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
    } catch { if (isMounted.current) setPhase("error"); }
  }, []);

  useEffect(() => {
    if (monday && boardId) fetchAndCalc(monday, boardId, settings);
  }, [monday, boardId, settings, fetchAndCalc]);

  const openSettings = () => { if (monday) monday.execute("openSettings"); };
  const decimals = Math.min(Math.max(parseInt(settings.decimals || "2", 10), 0), 4);
  const suffix = extractSuffix(settings);
  const multiplyBy100 = extractBool(settings.multiplyBy100);
  const displayValue = result !== null ? (multiplyBy100 ? result * 100 : result) : null;
  const formatted = displayValue !== null ? displayValue.toFixed(decimals) : null;
  const color = isDark ? "#d5d8df" : "#323338";
  const muted = isDark ? "#6b6f7d" : "#676879";
  const FONT = "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const root: React.CSSProperties = {
    width: "100%", height: "100%", minHeight: 100,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    fontFamily: FONT, background: "transparent",
    padding: "8px 12px", boxSizing: "border-box",
  };

  const numStyle: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: "clamp(40px, 10vw, 72px)",
    fontWeight: 300, color,
    letterSpacing: "-0.02em", lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  };

  if (phase === "init" || phase === "loading") {
    return <div style={root}><span style={{ ...numStyle, opacity: 0.2 }}>—</span></div>;
  }
  if (phase === "no-settings") {
    return (
      <div style={root}>
        <p style={{ fontFamily: FONT, fontSize: 13, color: muted, margin: "0 0 10px", textAlign: "center" }}>Configura el widget</p>
        <button onClick={openSettings} style={{ fontFamily: FONT, padding: "5px 14px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Ajustes</button>
      </div>
    );
  }
  if (phase === "error") {
    return <div style={root}><p style={{ color: "#e2445c", fontSize: 13 }}>Error al cargar</p></div>;
  }

  return (
    <div style={root}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center" }}>
        <span style={numStyle}>{formatted}</span>
        {suffix && <span style={numStyle}>{suffix}</span>}
      </div>
    </div>
  );
}
