"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip);

interface Column {
  id: string;
  title: string;
  type: string;
}

interface Config {
  colImporte: string;
  colResultados: string;
  colClics: string;
  colFecha: string;
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

const STORAGE_KEY = "kpi_widget_config";

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
  const [columns, setColumns] = useState<Column[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [phase, setPhase] = useState<"init" | "setup" | "loading" | "ready" | "error">("init");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Partial<Config>>({});

  // 1. Init SDK
  useEffect(() => {
    import("monday-sdk-js").then((mod) => {
      const sdk = (mod.default as any)();
      setMonday(sdk);

      sdk.get("context").then((res: any) => {
        const data = res?.data;
        const id =
          data?.boardId?.toString() ||
          data?.boardIds?.[0]?.toString() ||
          data?.connectedBoards?.[0]?.boardId?.toString() ||
          null;
        setBoardId(id);
      }).catch(() => setPhase("error"));
    });
  }, []);

  // 2. When boardId is ready, fetch columns and saved config
  useEffect(() => {
    if (!monday || !boardId) return;

    const init = async () => {
      try {
        // Fetch board columns
        const res = await monday.api(
          `{ boards(ids:[${boardId}]) { columns { id title type } } }`
        );
        const cols: Column[] = res?.data?.boards?.[0]?.columns || [];
        setColumns(cols);

        // Load saved config from monday storage
        const stored = await monday.storage.instance.getItem(STORAGE_KEY);
        if (stored?.data?.value) {
          const savedConfig: Config = JSON.parse(stored.data.value);
          setConfig(savedConfig);
          setPhase("loading");
        } else {
          // No config yet — show setup
          setDraft({});
          setPhase("setup");
        }
      } catch {
        setPhase("error");
        setError("Error al conectar con el tablero.");
      }
    };

    init();
  }, [monday, boardId]);

  // 3. Fetch & calculate KPIs when config is ready
  const fetchAndCalculate = useCallback(async (sdk: any, bid: string, cfg: Config) => {
    setPhase("loading");
    try {
      const allItems: any[] = [];
      let cursor: string | null = null;

      do {
        const colIds = [cfg.colImporte, cfg.colResultados, cfg.colClics, cfg.colFecha]
          .filter(Boolean)
          .map((c) => `"${c}"`)
          .join(",");

        const query: string = cursor
          ? `{ boards(ids:[${bid}]) { items_page(limit:100, cursor:"${cursor}") { cursor items { column_values(ids:[${colIds}]) { id text } } } } }`
          : `{ boards(ids:[${bid}]) { items_page(limit:100) { cursor items { column_values(ids:[${colIds}]) { id text } } } } }`;

        const res = await sdk.api(query);
        const page = res?.data?.boards?.[0]?.items_page;
        if (!page) break;
        allItems.push(...(page.items || []));
        cursor = page.cursor || null;
      } while (cursor);

      // Calculate
      let totalImporte = 0, totalResultados = 0, totalClics = 0;
      const monthMap: Record<string, { label: string; importe: number; resultados: number; clics: number }> = {};

      for (const item of allItems) {
        const cols: Record<string, string> = {};
        (item.column_values || []).forEach((cv: any) => { cols[cv.id] = cv.text || ""; });

        const importe = parseFloat(cols[cfg.colImporte] || "0") || 0;
        const resultados = parseFloat(cols[cfg.colResultados] || "0") || 0;
        const clics = parseFloat(cols[cfg.colClics] || "0") || 0;
        const fecha = cols[cfg.colFecha] || "";

        totalImporte += importe;
        totalResultados += resultados;
        totalClics += clics;

        const key = getMonthKey(fecha);
        if (!monthMap[key]) monthMap[key] = { label: getMonthLabel(fecha), importe: 0, resultados: 0, clics: 0 };
        monthMap[key].importe += importe;
        monthMap[key].resultados += resultados;
        monthMap[key].clics += clics;
      }

      const monthly: MonthlyData[] = Object.entries(monthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => ({
          ...v,
          cpl: v.resultados > 0 ? v.importe / v.resultados : 0,
          cvr: v.clics > 0 ? (v.resultados / v.clics) * 100 : 0,
        }));

      setKpis({
        totalImporte,
        totalResultados,
        totalClics,
        cpl: totalResultados > 0 ? totalImporte / totalResultados : 0,
        cvr: totalClics > 0 ? (totalResultados / totalClics) * 100 : 0,
        monthly,
      });
      setPhase("ready");
    } catch (e: any) {
      setError(e?.message || "Error al cargar datos");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (phase === "loading" && monday && boardId && config) {
      fetchAndCalculate(monday, boardId, config);
    }
  }, [phase, monday, boardId, config, fetchAndCalculate]);

  // Save config
  const saveConfig = async () => {
    const cfg = draft as Config;
    if (!cfg.colImporte || !cfg.colResultados || !cfg.colClics || !cfg.colFecha) {
      alert("Por favor selecciona todas las columnas.");
      return;
    }
    await monday.storage.instance.setItem(STORAGE_KEY, JSON.stringify(cfg));
    setConfig(cfg);
    setPhase("loading");
  };

  const resetConfig = async () => {
    await monday.storage.instance.deleteItem(STORAGE_KEY);
    setConfig(null);
    setDraft({});
    setPhase("setup");
  };

  // ── Numeric and date columns for selects
  const numericCols = columns.filter((c) => c.type === "numbers");
  const dateCols = columns.filter((c) => c.type === "date" || c.type === "formula");

  // ── Renders ──────────────────────────────────────

  if (phase === "init") return <Loader msg="Conectando con Monday..." />;
  if (phase === "loading") return <Loader msg="Cargando datos del tablero..." />;
  if (phase === "error") return <ErrorMsg msg={error || "Error inesperado"} />;

  if (phase === "setup") {
    return (
      <div style={s.container}>
        <div style={s.setupCard}>
          <p style={s.setupTitle}>Configura el widget</p>
          <p style={s.setupSub}>Selecciona qué columnas de este tablero corresponden a cada métrica.</p>

          {[
            { key: "colImporte", label: "Importe gastado", cols: numericCols },
            { key: "colResultados", label: "Leads / Resultados", cols: numericCols },
            { key: "colClics", label: "Clics", cols: numericCols },
            { key: "colFecha", label: "Fecha", cols: dateCols },
          ].map(({ key, label, cols }) => (
            <div key={key} style={s.formRow}>
              <label style={s.formLabel}>{label}</label>
              <select
                style={s.select}
                value={(draft as any)[key] || ""}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              >
                <option value="">— Selecciona columna —</option>
                {cols.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>
          ))}

          <button style={s.btn} onClick={saveConfig}>Guardar y cargar KPIs ↗</button>
        </div>
      </div>
    );
  }

  // Ready
  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>KPIs de campaña</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.btnSmall} onClick={() => monday && boardId && config && fetchAndCalculate(monday, boardId, config)}>↻</button>
          <button style={s.btnSmall} onClick={resetConfig}>⚙</button>
        </div>
      </div>

      <div style={s.kpiGrid}>
        <KpiCard label="CPL — Coste por lead" value={`${fmt(kpis!.cpl)} €`} sub={`${fmt(kpis!.totalImporte)} € ÷ ${kpis!.totalResultados} leads`} color="#0073ea" />
        <KpiCard label="CVR — Tasa de conversión" value={`${fmt(kpis!.cvr)} %`} sub={`${kpis!.totalResultados} leads ÷ ${kpis!.totalClics} clics`} color="#00c875" />
        <KpiCard label="Importe gastado" value={`${fmt(kpis!.totalImporte)} €`} sub="suma total del período" color="#ff7575" />
        <KpiCard label="Leads totales" value={`${kpis!.totalResultados}`} sub="suma total del período" color="#a25ddc" />
      </div>

      {kpis!.monthly.length > 1 ? (
        <>
          <p style={s.sectionLabel}>Evolución del CPL por mes</p>
          <div style={s.chartWrap}>
            <Bar
              data={{ labels: kpis!.monthly.map((m) => m.label), datasets: [{ data: kpis!.monthly.map((m) => parseFloat(m.cpl.toFixed(2))), backgroundColor: "#0073ea", borderRadius: 4 }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => `${c.raw.toFixed(2)} €` } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v: any) => `${v} €` } } } }}
            />
          </div>

          <p style={s.sectionLabel}>Evolución del CVR por mes</p>
          <div style={s.chartWrap}>
            <Bar
              data={{ labels: kpis!.monthly.map((m) => m.label), datasets: [{ data: kpis!.monthly.map((m) => parseFloat(m.cvr.toFixed(2))), backgroundColor: "#00c875", borderRadius: 4 }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => `${c.raw.toFixed(2)} %` } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v: any) => `${v} %` } } } }}
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
                  <tr key={i} style={i % 2 === 0 ? { background: "#fafafa" } : {}}>
                    <td style={s.td}>{m.label}</td>
                    <td style={{ ...s.td, textAlign: "right" }}>{fmt(m.importe)} €</td>
                    <td style={{ ...s.td, textAlign: "right" }}>{m.resultados}</td>
                    <td style={{ ...s.td, textAlign: "right" }}>{m.clics}</td>
                    <td style={{ ...s.td, textAlign: "right", color: "#0073ea", fontWeight: 500 }}>{fmt(m.cpl)} €</td>
                    <td style={{ ...s.td, textAlign: "right", color: "#00c875", fontWeight: 500 }}>{fmt(m.cvr)} %</td>
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
      <div style={{ fontSize: 10, color: "#676879", textTransform: "uppercase" as const, letterSpacing: ".04em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#676879" }}>{sub}</div>
    </div>
  );
}

function Loader({ msg }: { msg: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", minHeight: 200 }}>
      <div style={{ width: 32, height: 32, border: "3px solid #e6e9ef", borderTop: "3px solid #0073ea", borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 12 }} />
      <p style={{ color: "#676879", fontSize: 13 }}>{msg}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return <div style={{ color: "#d83a52", textAlign: "center" as const, padding: 20 }}>⚠ {msg}</div>;
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: "16px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#323338", fontSize: 14 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  headerTitle: { fontSize: 15, fontWeight: 600 },
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 20 },
  sectionLabel: { fontSize: 11, color: "#676879", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, marginTop: 4 },
  chartWrap: { position: "relative", width: "100%", height: 200, marginBottom: 20 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: "6px 10px", background: "#f6f7fb", color: "#676879", fontWeight: 500, borderBottom: "1px solid #e6e9ef" },
  td: { padding: "6px 10px", borderBottom: "1px solid #f0f0f0" },
  notice: { fontSize: 13, color: "#676879", textAlign: "center", marginTop: 20 },
  btn: { marginTop: 16, padding: "8px 18px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500, width: "100%" },
  btnSmall: { padding: "4px 10px", border: "1px solid #c3c6d4", background: "#fff", borderRadius: 4, cursor: "pointer", fontSize: 13 },
  setupCard: { background: "#f6f7fb", borderRadius: 10, padding: "20px" },
  setupTitle: { fontSize: 15, fontWeight: 600, marginBottom: 6 },
  setupSub: { fontSize: 12, color: "#676879", marginBottom: 16 },
  formRow: { marginBottom: 12 },
  formLabel: { display: "block", fontSize: 12, color: "#676879", marginBottom: 4 },
  select: { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #c3c6d4", fontSize: 13, background: "#fff" },
};
