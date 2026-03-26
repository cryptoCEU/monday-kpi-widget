"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  type ChartOptions,
  type ChartData,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

interface Settings {
  colImporte?: any;
  colResultados?: any;
  colFecha?: any;
  multiplyBy100?: any;
  ref1_label?: string;
  ref1_value?: string;
  ref1_color?: string;
  ref2_label?: string;
  ref2_value?: string;
  ref2_color?: string;
  ref3_label?: string;
  ref3_value?: string;
  ref3_color?: string;
}

interface MonthlyPoint {
  label: string;
  cpl: number;
}

function extractColId(val: any): string | null {
  if (!val) return null;
  if (typeof val === "string") return val || null;
  if (val.id) return val.id;
  if (val.value) return val.value;
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

function extractBool(val: any): boolean {
  if (!val) return false;
  if (val === true || val === "true" || val === 1 || val === "1") return true;
  if (typeof val === "object") {
    return Object.values(val).some((v) => v === true || v === "true" || v === 1);
  }
  return false;
}

function getMonthKey(dateStr: string): string {
  return dateStr ? dateStr.substring(0, 7) : "0000-00";
}

function getMonthLabel(dateStr: string): string {
  if (!dateStr) return "Sin fecha";
  try {
    const [year, month] = dateStr.split("-");
    const d = new Date(parseInt(year), parseInt(month) - 1, 1);
    return d.toLocaleString("es-ES", { month: "short", year: "2-digit" });
  } catch {
    return dateStr.substring(0, 7);
  }
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals).replace(".", ",");
}

export default function CplEvolutionWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [data, setData] = useState<MonthlyPoint[]>([]);
  const [phase, setPhase] = useState<"init" | "no-settings" | "loading" | "ready" | "error">("init");
  const [error, setError] = useState("");
  const [isDark, setIsDark] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    import("monday-sdk-js").then((mod) => {
      const sdk = (mod.default as any)();
      setMonday(sdk);

      sdk.get("context").then((res: any) => {
        if (!isMounted.current) return;
        const d = res?.data;
        const t = d?.theme || "dark";
        setIsDark(t === "dark" || t === "black");
        const id = d?.boardId?.toString() || d?.boardIds?.[0]?.toString() || d?.connectedBoards?.[0]?.boardId?.toString() || null;
        setBoardId(id);
      });

      sdk.listen("context", (res: any) => {
        if (!isMounted.current) return;
        setIsDark((res?.data?.theme || "dark") === "dark" || res?.data?.theme === "black");
      });

      sdk.get("settings").then((res: any) => { if (isMounted.current) setSettings(res?.data || {}); });
      sdk.listen("settings", (res: any) => { if (isMounted.current) setSettings(res?.data || {}); });
    });
    return () => { isMounted.current = false; };
  }, []);

  const fetchAndBuild = useCallback(async (sdk: any, bid: string, cfg: Settings) => {
    const colImporte = extractColId(cfg.colImporte);
    const colResultados = extractColId(cfg.colResultados);
    const colFecha = extractColId(cfg.colFecha);

    if (!colImporte || !colResultados || !colFecha) {
      setPhase("no-settings");
      return;
    }

    setPhase("loading");
    try {
      const ids = `"${colImporte}", "${colResultados}", "${colFecha}"`;
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

      // Group by month
      const monthMap: Record<string, { importe: number; resultados: number }> = {};

      all.forEach((item) => {
        const cols: Record<string, string> = {};
        (item.column_values || []).forEach((cv: any) => { cols[cv.id] = cv.text || ""; });

        const importe = parseFloat(cols[colImporte] || "0") || 0;
        const resultados = parseFloat(cols[colResultados] || "0") || 0;
        const fecha = cols[colFecha] || "";
        const key = getMonthKey(fecha);

        if (!monthMap[key]) monthMap[key] = { importe: 0, resultados: 0 };
        monthMap[key].importe += importe;
        monthMap[key].resultados += resultados;
      });

      const multiply = extractBool(cfg.multiplyBy100);

      const points: MonthlyPoint[] = Object.entries(monthMap)
        .filter(([key]) => key !== "0000-00")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => {
          const rawCpl = v.resultados > 0 ? v.importe / v.resultados : 0;
          return {
            label: getMonthLabel(key + "-01"),
            cpl: multiply ? rawCpl * 100 : rawCpl,
          };
        });

      if (isMounted.current) { setData(points); setPhase("ready"); }
    } catch (e: any) {
      if (isMounted.current) { setError(e?.message || "Error"); setPhase("error"); }
    }
  }, []);

  useEffect(() => {
    if (monday && boardId) fetchAndBuild(monday, boardId, settings);
  }, [monday, boardId, settings, fetchAndBuild]);

  const openSettings = () => { if (monday) monday.execute("openSettings"); };

  const FONT = "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const bg = isDark ? "#1f2130" : "#ffffff";
  const textPrimary = isDark ? "#d5d8df" : "#323338";
  const textMuted = isDark ? "#7c84a3" : "#676879";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const lineColor = "#4d90fe";

  // Reference lines from settings
  const refs = [
    { label: settings.ref1_label || "", value: parseFloat(settings.ref1_value || ""), color: settings.ref1_color || "#e2445c" },
    { label: settings.ref2_label || "", value: parseFloat(settings.ref2_value || ""), color: settings.ref2_color || "#00c875" },
    { label: settings.ref3_label || "", value: parseFloat(settings.ref3_value || ""), color: settings.ref3_color || "#ffcb00" },
  ].filter((r) => r.label && !isNaN(r.value) && r.value > 0);

  if (phase === "init" || phase === "loading") {
    return (
      <div style={{ background: bg, width: "100%", height: "100%", minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 24, height: 24, border: `3px solid ${textMuted}`, borderTop: `3px solid ${lineColor}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (phase === "no-settings" || phase === "error") {
    return (
      <div style={{ background: bg, width: "100%", height: "100%", minHeight: 220, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" as const, fontFamily: FONT }}>
        <p style={{ color: textPrimary, fontSize: 14, fontWeight: 500, margin: "0 0 6px" }}>
          {phase === "error" ? "Error al cargar" : "Configura el widget"}
        </p>
        <p style={{ color: textMuted, fontSize: 12, margin: "0 0 16px", maxWidth: 240, lineHeight: 1.5 }}>
          {phase === "error" ? error : "Selecciona las columnas de importe, resultados y fecha."}
        </p>
        <button onClick={openSettings} style={{ fontFamily: FONT, padding: "6px 18px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>
          Abrir ajustes
        </button>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{ background: bg, width: "100%", height: "100%", minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
        <p style={{ color: textMuted, fontSize: 13 }}>Sin datos para mostrar</p>
      </div>
    );
  }

  // Build Chart.js annotation-like reference lines as extra datasets
  const refDatasets = refs.map((ref) => ({
    label: ref.label,
    data: data.map(() => ref.value),
    type: "line" as const,
    borderColor: ref.color,
    borderWidth: 1.5,
    borderDash: [6, 4],
    pointRadius: 0,
    pointHoverRadius: 0,
    backgroundColor: "transparent",
    fill: false,
    tension: 0,
  }));

  const chartData: any = {
    labels: data.map((d) => d.label),
    datasets: [
      {
        label: "CPL",
        data: data.map((d) => parseFloat(d.cpl.toFixed(2))),
        backgroundColor: lineColor,
        borderRadius: 4,
        borderSkipped: false,
      },
      ...refDatasets,
    ],
  };

  const chartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        display: refs.length > 0,
        position: "bottom",
        labels: {
          color: textMuted,
          font: { family: FONT, size: 11 },
          boxWidth: 16,
          padding: 12,
          usePointStyle: true,
          pointStyleWidth: 12,
        },
      },
      tooltip: {
        backgroundColor: isDark ? "#2d3047" : "#fff",
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
        borderWidth: 1,
        titleColor: textPrimary,
        bodyColor: textMuted,
        titleFont: { family: FONT, size: 12 },
        bodyFont: { family: FONT, size: 11 },
        callbacks: {
          label: (ctx: any) => ` ${ctx.dataset.label}: ${fmt(ctx.raw as number)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: textMuted, font: { family: FONT, size: 11 } },
      },
      y: {
        grid: { color: gridColor },
        ticks: {
          color: textMuted,
          font: { family: FONT, size: 11 },
          callback: (v: any) => fmt(v as number),
        },
      },
    },
  };

  const lastCpl = data[data.length - 1]?.cpl || 0;
  const prevCpl = data[data.length - 2]?.cpl || lastCpl;
  const trend = lastCpl - prevCpl;
  const trendColor = trend <= 0 ? "#00c875" : "#e2445c";
  const trendArrow = trend <= 0 ? "↓" : "↑";

  return (
    <div style={{ background: bg, width: "100%", height: "100%", fontFamily: FONT, padding: "14px 16px 12px", boxSizing: "border-box" as const }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: textMuted, marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
            Evolución del CPL
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 300, color: textPrimary, letterSpacing: "-0.02em" }}>
              {fmt(lastCpl)}
            </span>
            {data.length > 1 && (
              <span style={{ fontSize: 13, fontWeight: 500, color: trendColor }}>
                {trendArrow} {fmt(Math.abs(trend))}
              </span>
            )}
          </div>
        </div>
        {/* Reference pills */}
        {refs.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, justifyContent: "flex-end", maxWidth: "50%" }}>
            {refs.map((ref, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", borderRadius: 4, padding: "3px 8px" }}>
                <span style={{ width: 20, height: 2, background: ref.color, display: "inline-block", borderRadius: 1 }} />
                <span style={{ fontSize: 11, color: textMuted }}>{ref.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: ref.color }}>{fmt(ref.value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart */}
      <div style={{ position: "relative" as const, height: 200 }}>
        <Bar data={chartData} options={chartOptions} />
      </div>
    </div>
  );
}
