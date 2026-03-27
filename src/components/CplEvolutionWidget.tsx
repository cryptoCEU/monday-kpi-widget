"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Settings {
  colImporte?: any;
  colResultados?: any;
  colFecha?: any;
  multiplyBy100?: any;
  ref1_label?: string; ref1_value?: string; ref1_color?: string;
  ref2_label?: string; ref2_value?: string; ref2_color?: string;
  ref3_label?: string; ref3_value?: string; ref3_color?: string;
}

interface MonthlyPoint { label: string; cpl: number; }

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

function extractBool(val: any): boolean {
  if (!val) return false;
  if (val === true || val === "true" || val === 1 || val === "1") return true;
  if (typeof val === "object") return Object.values(val).some((v) => v === true || v === "true" || v === 1);
  return false;
}

function getMonthKey(d: string): string { return d ? d.substring(0, 7) : "0000-00"; }
function getMonthLabel(key: string): string {
  try {
    const [y, m] = key.split("-");
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString("es-ES", { month: "short", year: "2-digit" });
  } catch { return key; }
}
function fmt(n: number): string { return n.toFixed(2).replace(".", ","); }

export default function CplEvolutionWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [data, setData] = useState<MonthlyPoint[]>([]);
  const [phase, setPhase] = useState<"init" | "no-settings" | "loading" | "ready" | "error">("init");
  const [error, setError] = useState("");
  const [isDark, setIsDark] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<any>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    import("monday-sdk-js").then((mod) => {
      const sdk = (mod.default as any)();
      setMonday(sdk);
      sdk.get("context").then((res: any) => {
        if (!isMounted.current) return;
        const d = res?.data;
        setIsDark((d?.theme || "dark") === "dark" || d?.theme === "black");
        setIsExporting(!!d?.isExporting);
        const id = d?.boardId?.toString() || d?.boardIds?.[0]?.toString() || d?.connectedBoards?.[0]?.boardId?.toString() || null;
        setBoardId(id);
      });
      sdk.listen("context", (res: any) => {
        if (!isMounted.current) return;
        const d = res?.data;
        setIsDark((d?.theme || "dark") === "dark" || d?.theme === "black");
        setIsExporting(!!d?.isExporting);
      });
      sdk.get("settings").then((res: any) => { if (isMounted.current) setSettings(res?.data || {}); });
      sdk.listen("settings", (res: any) => { if (isMounted.current) setSettings(res?.data || {}); });
    });
    return () => { isMounted.current = false; };
  }, []);

  const fetchAndBuild = useCallback(async (sdk: any, bid: string, cfg: Settings) => {
    const colI = extractColId(cfg.colImporte);
    const colR = extractColId(cfg.colResultados);
    const colF = extractColId(cfg.colFecha);
    if (!colI || !colR || !colF) { setPhase("no-settings"); return; }
    setPhase("loading");
    try {
      const ids = `"${colI}", "${colR}", "${colF}"`;
      const all: any[] = [];
      let cursor: string | null = null;
      do {
        const q: string = cursor
          ? `{ boards(ids:[${bid}]) { items_page(limit:100, cursor:"${cursor}") { cursor items { column_values(ids:[${ids}]) { id text } } } } }`
          : `{ boards(ids:[${bid}]) { items_page(limit:100) { cursor items { column_values(ids:[${ids}]) { id text } } } } }`;
        const r = await sdk.api(q);
        const page = r?.data?.boards?.[0]?.items_page;
        if (!page) break;
        all.push(...(page.items || []));
        cursor = page.cursor || null;
      } while (cursor);

      const map: Record<string, { i: number; r: number }> = {};
      all.forEach((item) => {
        const cols: Record<string, string> = {};
        (item.column_values || []).forEach((cv: any) => { cols[cv.id] = cv.text || ""; });
        const imp = parseFloat(cols[colI] || "0") || 0;
        const res = parseFloat(cols[colR] || "0") || 0;
        const fecha = cols[colF] || "";
        const key = getMonthKey(fecha);
        if (!map[key]) map[key] = { i: 0, r: 0 };
        map[key].i += imp;
        map[key].r += res;
      });

      const multiply = extractBool(cfg.multiplyBy100);
      const points: MonthlyPoint[] = Object.entries(map)
        .filter(([k]) => k !== "0000-00")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => ({
          label: getMonthLabel(key),
          cpl: v.r > 0 ? (multiply ? (v.i / v.r) * 100 : v.i / v.r) : 0,
        }));

      if (isMounted.current) { setData(points); setPhase("ready"); }
    } catch (e: any) {
      if (isMounted.current) { setError(e?.message || "Error"); setPhase("error"); }
    }
  }, []);

  useEffect(() => {
    if (monday && boardId) fetchAndBuild(monday, boardId, settings);
  }, [monday, boardId, settings, fetchAndBuild]);

  // Draw chart with vanilla Canvas API — no Chart.js dependency issues
  useEffect(() => {
    if (phase !== "ready" || !canvasRef.current || data.length === 0) return;

    // Destroy previous chart instance
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Parse reference lines
    const refs = [
      { label: settings.ref1_label || "", value: parseFloat(settings.ref1_value || ""), color: settings.ref1_color || "#e2445c" },
      { label: settings.ref2_label || "", value: parseFloat(settings.ref2_value || ""), color: settings.ref2_color || "#00c875" },
      { label: settings.ref3_label || "", value: parseFloat(settings.ref3_value || ""), color: settings.ref3_color || "#ffcb00" },
    ].filter((r) => r.label && !isNaN(r.value) && r.value > 0);

    // Import and use Chart.js dynamically
    import("chart.js/auto").then(({ Chart }) => {
      if (!canvasRef.current || !isMounted.current) return;
      if (chartRef.current) chartRef.current.destroy();

      const textColor = isDark ? "#7c84a3" : "#676879";
      const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
      const barColor = "#4d90fe";
      const FONT = "'Figtree', sans-serif";

      const refDatasets = refs.map((ref) => ({
        type: "line" as const,
        label: ref.label,
        data: data.map(() => ref.value),
        borderColor: ref.color,
        borderWidth: 1.5,
        borderDash: [6, 4],
        pointRadius: 0,
        backgroundColor: "transparent",
        fill: false,
        order: 0,
      }));

      chartRef.current = new Chart(canvasRef.current!, {
        type: "bar",
        data: {
          labels: data.map((d) => d.label),
          datasets: [
            {
              type: "bar" as const,
              label: "CPL",
              data: data.map((d) => parseFloat(d.cpl.toFixed(2))),
              backgroundColor: barColor,
              borderRadius: 4,
              order: 1,
            },
            ...refDatasets,
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              display: refs.length > 0,
              position: "bottom",
              labels: {
                color: textColor,
                font: { family: FONT, size: 11 },
                boxWidth: 14,
                padding: 10,
                usePointStyle: true,
              },
            },
            tooltip: {
              backgroundColor: isDark ? "#2d3047" : "#fff",
              borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
              borderWidth: 1,
              titleColor: isDark ? "#d5d8df" : "#323338",
              bodyColor: textColor,
              callbacks: {
                label: (ctx: any) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}`,
              },
            },
          },
          scales: {
            x: {
              grid: { color: gridColor },
              ticks: { color: textColor, font: { family: FONT, size: 11 } },
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: FONT, size: 11 },
                callback: (v: any) => fmt(v),
              },
            },
          },
        },
      });
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [phase, data, settings, isDark, isExporting]);

  const openSettings = () => { if (monday) monday.execute("openSettings"); };
  const FONT = "'Figtree', -apple-system, sans-serif";
  const bg = isDark ? "#1f2130" : "#ffffff";
  const textPrimary = isDark ? "#d5d8df" : "#323338";
  const textMuted = isDark ? "#7c84a3" : "#676879";

  if (phase === "init" || phase === "loading") {
    return (
      <div style={{ background: bg, width: "100%", height: "100%", minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {!isExporting && (
          <>
            <div style={{ width: 24, height: 24, border: `3px solid ${textMuted}`, borderTop: "3px solid #4d90fe", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </>
        )}
      </div>
    );
  }

  if (phase === "no-settings" || phase === "error") {
    return (
      <div style={{ background: bg, width: "100%", height: "100%", minHeight: 220, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" as const, fontFamily: FONT }}>
        <p style={{ color: textPrimary, fontSize: 14, fontWeight: 500, margin: "0 0 6px" }}>{phase === "error" ? "Error al cargar" : "Configura el widget"}</p>
        <p style={{ color: textMuted, fontSize: 12, margin: "0 0 16px", maxWidth: 240, lineHeight: 1.5 }}>{phase === "error" ? error : "Selecciona importe, resultados y fecha desde los ajustes."}</p>
        <button onClick={openSettings} style={{ fontFamily: FONT, padding: "6px 18px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>Abrir ajustes</button>
      </div>
    );
  }

  const lastCpl = data[data.length - 1]?.cpl || 0;
  const prevCpl = data[data.length - 2]?.cpl || lastCpl;
  const trend = lastCpl - prevCpl;

  return (
    <div style={{ background: bg, width: "100%", height: "100%", fontFamily: FONT, padding: "14px 16px 12px", boxSizing: "border-box" as const }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: textMuted, marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Evolución del CPL</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 300, color: textPrimary, letterSpacing: "-0.02em" }}>{fmt(lastCpl)}</span>
            {data.length > 1 && (
              <span style={{ fontSize: 13, fontWeight: 500, color: trend <= 0 ? "#00c875" : "#e2445c" }}>
                {trend <= 0 ? "↓" : "↑"} {fmt(Math.abs(trend))}
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ position: "relative" as const, height: 200 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
