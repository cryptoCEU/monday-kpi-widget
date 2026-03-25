"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

// Column IDs del tablero LA NUCIA — configurable
const COL_IMPORTE = "numeric_mm1swjbd";
const COL_RESULTADOS = "numeric_mm1s7a4";
const COL_CLICS = "numeric_mm1swt56";
const COL_FECHA = "date_mm1sf4w9";

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

function getMonthLabel(dateStr: string): string {
  if (!dateStr) return "Sin fecha";
  const d = new Date(dateStr);
  return `${d.toLocaleString("es-ES", { month: "short" })} ${d.getFullYear()}`;
}

function getMonthKey(dateStr: string): string {
  if (!dateStr) return "0000-00";
  return dateStr.substring(0, 7);
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals).replace(".", ",");
}

export default function KpiWidget() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [monday, setMonday] = useState<any>(null);

  // Inicializar Monday SDK
  useEffect(() => {
    import("monday-sdk-js").then((mod) => {
      const mondaySdk = mod.default();
      mondaySdk.init();
      setMonday(mondaySdk);

      mondaySdk.get("context").then((res: any) => {
        const id = res?.data?.boardId?.toString() || null;
        setBoardId(id);
      });
    });
  }, []);

  const fetchAndCalculate = useCallback(
    async (sdk: any, bid: string) => {
      setLoading(true);
      setError(null);
      try {
        const allItems: any[] = [];
        let cursor: string | null = null;

        // Paginar todos los items
        do {
          const query = cursor
            ? `{ boards(ids: [${bid}]) { items_page(limit: 100, cursor: "${cursor}") { cursor items { column_values(ids: ["${COL_IMPORTE}","${COL_RESULTADOS}","${COL_CLICS}","${COL_FECHA}"]) { id text } } } } }`
            : `{ boards(ids: [${bid}]) { items_page(limit: 100) { cursor items { column_values(ids: ["${COL_IMPORTE}","${COL_RESULTADOS}","${COL_CLICS}","${COL_FECHA}"]) { id text } } } } }`;

          const res = await sdk.api(query);
          const page = res?.data?.boards?.[0]?.items_page;
          if (!page) break;

          const items = page.items || [];
          allItems.push(...items);
          cursor = page.cursor || null;
        } while (cursor);

        // Procesar items
        let totalImporte = 0;
        let totalResultados = 0;
        let totalClics = 0;
        const monthMap: Record<string, { importe: number; resultados: number; clics: number; label: string }> = {};

        for (const item of allItems) {
          const cols: Record<string, string> = {};
          for (const cv of item.column_values || []) {
            cols[cv.id] = cv.text || "";
          }

          const importe = parseFloat(cols[COL_IMPORTE] || "0") || 0;
          const resultados = parseFloat(cols[COL_RESULTADOS] || "0") || 0;
          const clics = parseFloat(cols[COL_CLICS] || "0") || 0;
          const fecha = cols[COL_FECHA] || "";

          totalImporte += importe;
          totalResultados += resultados;
          totalClics += clics;

          const key = getMonthKey(fecha);
          if (!monthMap[key]) {
            monthMap[key] = { importe: 0, resultados: 0, clics: 0, label: getMonthLabel(fecha) };
          }
          monthMap[key].importe += importe;
          monthMap[key].resultados += resultados;
          monthMap[key].clics += clics;
        }

        // Calcular CPL y CVR globales
        const cpl = totalResultados > 0 ? totalImporte / totalResultados : 0;
        const cvr = totalClics > 0 ? (totalResultados / totalClics) * 100 : 0;

        // Evolución mensual
        const monthly: MonthlyData[] = Object.entries(monthMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, v]) => ({
            label: v.label,
            importe: v.importe,
            resultados: v.resultados,
            clics: v.clics,
            cpl: v.resultados > 0 ? v.importe / v.resultados : 0,
            cvr: v.clics > 0 ? (v.resultados / v.clics) * 100 : 0,
          }));

        setKpis({ totalImporte, totalResultados, totalClics, cpl, cvr, monthly });
      } catch (e: any) {
        setError(e?.message || "Error al cargar datos");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (monday && boardId) {
      fetchAndCalculate(monday, boardId);
    }
  }, [monday, boardId, fetchAndCalculate]);

  if (loading) return <Loader />;
  if (error) return <ErrorMsg msg={error} />;
  if (!kpis) return null;

  const cplChartData = {
    labels: kpis.monthly.map((m) => m.label),
    datasets: [
      {
        label: "CPL (€)",
        data: kpis.monthly.map((m) => parseFloat(m.cpl.toFixed(2))),
        backgroundColor: "#0073ea",
        borderRadius: 4,
      },
    ],
  };

  const cvrChartData = {
    labels: kpis.monthly.map((m) => m.label),
    datasets: [
      {
        label: "CVR (%)",
        data: kpis.monthly.map((m) => parseFloat(m.cvr.toFixed(2))),
        backgroundColor: "#00c875",
        borderRadius: 4,
      },
    ],
  };

  const chartOptions = (suffix: string) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${fmt(ctx.raw)} ${suffix}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: {
        grid: { color: "rgba(0,0,0,0.05)" },
        ticks: {
          font: { size: 11 },
          callback: (v: any) => `${fmt(v)} ${suffix}`,
        },
      },
    },
  });

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>KPIs de campaña</span>
        <button
          style={styles.refreshBtn}
          onClick={() => monday && boardId && fetchAndCalculate(monday, boardId)}
        >
          ↻ Actualizar
        </button>
      </div>

      {/* KPI Cards */}
      <div style={styles.kpiGrid}>
        <KpiCard
          label="CPL — Coste por lead"
          value={`${fmt(kpis.cpl)} €`}
          sub={`${fmt(kpis.totalImporte)} € ÷ ${kpis.totalResultados} resultados`}
          color="#0073ea"
        />
        <KpiCard
          label="CVR — Tasa de conversión"
          value={`${fmt(kpis.cvr)} %`}
          sub={`${kpis.totalResultados} resultados ÷ ${kpis.totalClics} clics`}
          color="#00c875"
        />
        <KpiCard
          label="Importe gastado total"
          value={`${fmt(kpis.totalImporte)} €`}
          sub="suma total del período"
          color="#ff7575"
        />
        <KpiCard
          label="Leads totales"
          value={kpis.totalResultados.toString()}
          sub="suma total del período"
          color="#a25ddc"
        />
      </div>

      {/* Charts */}
      {kpis.monthly.length > 1 && (
        <>
          <div style={styles.sectionLabel}>Evolución del CPL por mes</div>
          <div style={styles.chartWrap}>
            <Bar data={cplChartData} options={chartOptions("€") as any} />
          </div>

          <div style={styles.sectionLabel}>Evolución del CVR por mes</div>
          <div style={styles.chartWrap}>
            <Bar data={cvrChartData} options={chartOptions("%") as any} />
          </div>

          {/* Monthly table */}
          <div style={styles.sectionLabel}>Detalle mensual</div>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Mes", "Gastado", "Leads", "Clics", "CPL", "CVR"].map((h) => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kpis.monthly.map((m, i) => (
                  <tr key={i} style={i % 2 === 0 ? styles.trEven : {}}>
                    <td style={styles.td}>{m.label}</td>
                    <td style={styles.tdNum}>{fmt(m.importe)} €</td>
                    <td style={styles.tdNum}>{m.resultados}</td>
                    <td style={styles.tdNum}>{m.clics}</td>
                    <td style={{ ...styles.tdNum, color: "#0073ea", fontWeight: 500 }}>{fmt(m.cpl)} €</td>
                    <td style={{ ...styles.tdNum, color: "#00c875", fontWeight: 500 }}>{fmt(m.cvr)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {kpis.monthly.length <= 1 && (
        <p style={styles.notice}>
          Sube datos de más de un mes para ver la evolución temporal.
        </p>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ ...styles.kpiCard, borderTop: `3px solid ${color}` }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color }}>{value}</div>
      <div style={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function Loader() {
  return (
    <div style={styles.center}>
      <div style={styles.spinner} />
      <p style={{ marginTop: 12, color: "#676879" }}>Cargando datos del tablero...</p>
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={styles.center}>
      <p style={{ color: "#d83a52" }}>⚠ {msg}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: "16px", maxWidth: "100%", overflowX: "hidden" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  headerTitle: { fontSize: 15, fontWeight: 600, color: "#323338" },
  refreshBtn: {
    fontSize: 12, padding: "4px 12px", borderRadius: 4,
    border: "1px solid #c3c6d4", background: "#fff",
    cursor: "pointer", color: "#323338",
  },
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 20 },
  kpiCard: {
    background: "#f6f7fb", borderRadius: 8, padding: "12px 14px",
    borderTop: "3px solid #0073ea",
  },
  kpiLabel: { fontSize: 11, color: "#676879", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" },
  kpiValue: { fontSize: 24, fontWeight: 700, lineHeight: 1, marginBottom: 4 },
  kpiSub: { fontSize: 11, color: "#676879" },
  sectionLabel: {
    fontSize: 11, color: "#676879", textTransform: "uppercase",
    letterSpacing: "0.06em", marginBottom: 8, marginTop: 4,
  },
  chartWrap: { height: 200, marginBottom: 20 },
  tableWrap: { overflowX: "auto", marginBottom: 16 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: {
    textAlign: "left", padding: "6px 10px", background: "#f6f7fb",
    color: "#676879", fontWeight: 500, borderBottom: "1px solid #e6e9ef",
  },
  td: { padding: "6px 10px", borderBottom: "1px solid #f0f0f0", color: "#323338" },
  tdNum: { padding: "6px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "right" },
  trEven: { background: "#fafafa" },
  notice: { fontSize: 13, color: "#676879", textAlign: "center", marginTop: 20 },
  center: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200 },
  spinner: {
    width: 32, height: 32, border: "3px solid #e6e9ef",
    borderTop: "3px solid #0073ea", borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};
