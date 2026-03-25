"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface Settings {
  colImporte?: string;
  colResultados?: string;
  colClics?: string;
  colFecha?: string;
}

interface MonthlyData {
  label: string;
  importe: number;
  resultados: number;
  clics: number;
  cpl: number;
  cvr: number;
}

interface KPIs {
  totalImporte: number;
  totalResultados: number;
  totalClics: number;
  cpl: number;
  cvr: number;
  monthly: MonthlyData[];
}

function fmt(n: number): string {
  return parseFloat(n.toString()).toFixed(2).replace(".", ",");
}

function getMonthKey(dateStr: string): string {
  return dateStr ? dateStr.substring(0, 7) : "0000-00";
}

function getMonthLabel(dateStr: string): string {
  if (!dateStr) return "Sin fecha";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("es-ES", { month: "short", year: "numeric" });
  } catch {
    return dateStr.substring(0, 7);
  }
}

export default function KpiWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [phase, setPhase] = useState<"init" | "no-settings" | "loading" | "ready" | "error">("init");
  const [error, setError] = useState("");
  const isMounted = useRef(true);

  // 1. Init SDK — get context and settings
  useEffect(() => {
    isMounted.current = true;
    import("monday-sdk-js").then((mod) => {
      const sdk = (mod.default as any)();
      setMonday(sdk);

      // Get board from context
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

      // Get settings — this fires every time user changes settings in the native panel
      sdk.get("settings").then((res: any) => {
        if (!isMounted.current) return;
        setSettings(res?.data || {});
      });

      // Listen for settings changes in real time
      sdk.listen("settings", (res: any) => {
        if (!isMounted.current) return;
        setSettings(res?.data || {});
      });
    });

    return () => { isMounted.current = false; };
  }, []);

  // 2. Fetch data when boardId + settings are ready
  const fetchAndCalculate = useCallback(async (sdk: any, bid: string, cfg: Settings) => {
    if (!cfg.colImporte || !cfg.colResultados || !cfg.colClics || !cfg.colFecha) {
      setPhase("no-settings");
      return;
    }

    setPhase("loading");
    try {
      const colIds = [cfg.colImporte, cfg.colResultados, cfg.colClics, cfg.colFecha]
        .map((c) => `"${c}"`)
        .join(",");

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

      let totalImporte = 0, totalResultados = 0, totalClics = 0;
      const monthMap: Record<string, { label: string; importe: number; resultados: number; clics: number }> = {};

      for (const item of allItems) {
        const cols: Record<string, string> = {};
        (item.column_values || []).forEach((cv: any) => { cols[cv.id] = cv.text || ""; });

        const importe    = parseFloat(cols[cfg.colImporte!]    || "0") || 0;
        const resultados = parseFloat(cols[cfg.colResultados!] || "0") || 0;
        const clics      = parseFloat(cols[cfg.colClics!]      || "0") || 0;
        const fecha      = cols[cfg.colFecha!] || "";

        totalImporte    += importe;
        totalResultados += resultados;
        totalClics      += clics;

        const key = getMonthKey(fecha);
        if (!monthMap[key]) monthMap[key] = { label: getMonthLabel(fecha), importe: 0, resultados: 0, clics: 0 };
        monthMap[key].importe    += importe;
        monthMap[key].resultados += resultados;
        monthMap[key].clics      += clics;
      }

      const monthly: MonthlyData[] = Object.entries(monthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => ({
          ...v,
          cpl: v.resultados > 0 ? v.importe / v.resultados : 0,
          cvr: v.clics > 0 ? (v.resultados / v.clics) * 100 : 0,
        }));

      if (isMounted.current) {
        setKpis({
          totalImporte,
          totalResultados,
          totalClics,
          cpl: totalResultados > 0 ? totalImporte / totalResultados : 0,
          cvr: totalClics > 0 ? (totalResultados / totalClics) * 100 : 0,
          monthly,
        });
        setPhase("ready");
      }
    } catch (e: any) {
      if (isMounted.current) {
        setError(e?.message || "Error al cargar datos");
        setPhase("error");
      }
    }
  }, []);

  useEffect(() => {
    if (monday && boardId) {
      fetchAndCalculate(monday, boardId, settings);
    }
  }, [monday, boardId, settings, fetchAndCalculate]);

  const openSettings = () => {
    if (monday) monday.execute("openSettings");
  };

  // ── Renders ──────────────────────────────

  if (phase === "init") return <Loader />;

  if (phase === "no-settings") {
    return (
      <div style={s.emptyState}>
        <div style={s.emptyIcon}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#676879" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
        <p style={s.emptyTitle}>Configura el widget</p>
        <p style={s.emptySubtitle}>
          Pulsa el botón de configuración para seleccionar las columnas del tablero.
        </p>
        <button style={s.settingsBtn} onClick={openSettings}>
          Abrir configuración
        </button>
      </div>
    );
  }

  if (phase === "loading") return <Loader />;

  if (phase === "error") {
    return (
      <div style={s.emptyState}>
        <p style={{ color: "#e2445c", fontSize: 13 }}>⚠ {error}</p>
        <button style={s.settingsBtn} onClick={openSettings}>Revisar configuración</button>
      </div>
    );
  }

  // Ready
  return (
    <div style={s.container}>
      {/* KPI Cards */}
      <div style={s.kpiGrid}>
        <KpiCard label="CPL" value={`${fmt(kpis!.cpl)} €`} sub={`${fmt(kpis!.totalImporte)} € ÷ ${kpis!.totalResultados} leads`} color="#0073ea" />
        <KpiCard label="CVR" value={`${fmt(kpis!.cvr)} %`} sub={`${kpis!.totalResultados} leads ÷ ${kpis!.totalClics} clics`} color="#00c875" />
        <KpiCard label="Importe gastado" value={`${fmt(kpis!.totalImporte)} €`} sub="total del período" color="#ff7575" />
        <KpiCard label="Leads" value={`${kpis!.totalResultados}`} sub="total del período" color="#a25ddc" />
      </div>

      {/* Charts */}
      {kpis!.monthly.length > 1 ? (
        <>
          <p style={s.sectionLabel}>Evolución del CPL</p>
          <div style={s.chartWrap}>
            <Bar
              data={{
                labels: kpis!.monthly.map((m) => m.label),
                datasets: [{ data: kpis!.monthly.map((m) => parseFloat(m.cpl.toFixed(2))), backgroundColor: "#0073ea", borderRadius: 4 }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => `${c.raw.toFixed(2)} €` } } },
                scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 }, callback: (v: any) => `${v} €` }, grid: { color: "rgba(0,0,0,0.04)" } } },
              }}
            />
          </div>

          <p style={s.sectionLabel}>Evolución del CVR</p>
          <div style={s.chartWrap}>
            <Bar
              data={{
                labels: kpis!.monthly.map((m) => m.label),
                datasets: [{ data: kpis!.monthly.map((m) => parseFloat(m.cvr.toFixed(2))), backgroundColor: "#00c875", borderRadius: 4 }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => `${c.raw.toFixed(2)} %` } } },
                scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 }, callback: (v: any) => `${v} %` }, grid: { color: "rgba(0,0,0,0.04)" } } },
              }}
            />
          </div>

          <p style={s.sectionLabel}>Detalle mensual</p>
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>{["Mes", "Gastado", "Leads", "Clics", "CPL", "CVR"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {kpis!.monthly.map((m, i) => (
                  <tr key={i} style={i % 2 === 0 ? { background: "#fafbff" } : {}}>
                    <td style={s.td}>{m.label}</td>
                    <td style={{ ...s.td, textAlign: "right" as const }}>{fmt(m.importe)} €</td>
                    <td style={{ ...s.td, textAlign: "right" as const }}>{m.resultados}</td>
                    <td style={{ ...s.td, textAlign: "right" as const }}>{m.clics}</td>
                    <td style={{ ...s.td, textAlign: "right" as const, color: "#0073ea", fontWeight: 500 }}>{fmt(m.cpl)} €</td>
                    <td style={{ ...s.td, textAlign: "right" as const, color: "#00c875", fontWeight: 500 }}>{fmt(m.cvr)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={s.notice}>Sube datos de más de un mes para ver la evolución temporal.</p>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: "#f6f7fb", borderRadius: 8, padding: "12px 14px", borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 10, color: "#676879", textTransform: "uppercase" as const, letterSpacing: ".05em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1, marginBottom: 3 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#676879" }}>{sub}</div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", minHeight: 200 }}>
      <div style={{ width: 28, height: 28, border: "3px solid #e6e9ef", borderTop: "3px solid #0073ea", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: "14px 16px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#323338", fontSize: 13 },
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 16 },
  sectionLabel: { fontSize: 10, color: "#676879", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, marginTop: 2 },
  chartWrap: { position: "relative", width: "100%", height: 180, marginBottom: 16 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left" as const, padding: "5px 8px", background: "#f6f7fb", color: "#676879", fontWeight: 500, borderBottom: "1px solid #e6e9ef", fontSize: 11 },
  td: { padding: "5px 8px", borderBottom: "1px solid #f0f0f0" },
  notice: { fontSize: 12, color: "#676879", textAlign: "center", marginTop: 16 },
  emptyState: { display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", minHeight: 220, padding: 24, textAlign: "center" as const },
  emptyIcon: { marginBottom: 12, opacity: 0.6 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: "#323338", marginBottom: 6 },
  emptySubtitle: { fontSize: 12, color: "#676879", marginBottom: 16, maxWidth: 240, lineHeight: 1.5 },
  settingsBtn: { padding: "8px 20px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 },
};
