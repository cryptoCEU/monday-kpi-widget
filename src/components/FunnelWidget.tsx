"use client";

import { useEffect, useState, useCallback } from "react";

interface Column {
  id: string;
  title: string;
  type: string;
}

interface StepDraft {
  colId: string;
  label: string;
  color: string;
}

interface Config {
  steps: StepDraft[];
}

interface FunnelStep {
  label: string;
  value: number;
  color: string;
  pctOfFirst: number;
  pctOfPrev: number;
}

const STORAGE_KEY = "funnel_widget_config_v1";

const PALETTE = [
  "#0073ea", "#00c875", "#e2445c", "#ff7575",
  "#a25ddc", "#ffcb00", "#579bfc", "#ff642e",
  "#03c875", "#bb3354",
];

function fmtNum(n: number): string {
  return new Intl.NumberFormat("es-ES").format(Math.round(n));
}

function fmtPct(n: number): string {
  return n.toFixed(1).replace(".", ",") + "%";
}

export default function FunnelWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [phase, setPhase] = useState<"init" | "setup" | "loading" | "ready" | "error">("init");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<StepDraft[]>([
    { colId: "", label: "", color: PALETTE[0] },
    { colId: "", label: "", color: PALETTE[1] },
  ]);

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
      }).catch(() => { setPhase("error"); setError("No se pudo obtener el contexto del tablero."); });
    });
  }, []);

  // 2. Init board — fetch columns and saved config
  useEffect(() => {
    if (!monday || !boardId) return;
    const init = async () => {
      try {
        const res = await monday.api(`{ boards(ids:[${boardId}]) { columns { id title type } } }`);
        const cols: Column[] = res?.data?.boards?.[0]?.columns || [];
        setColumns(cols);

        const stored = await monday.storage.instance.getItem(STORAGE_KEY);
        if (stored?.data?.value) {
          const saved: Config = JSON.parse(stored.data.value);
          setConfig(saved);
          setPhase("loading");
        } else {
          setPhase("setup");
        }
      } catch {
        setPhase("error");
        setError("Error al conectar con el tablero.");
      }
    };
    init();
  }, [monday, boardId]);

  // 3. Fetch data and build funnel
  const fetchAndBuild = useCallback(async (sdk: any, bid: string, cfg: Config) => {
    setPhase("loading");
    try {
      const colIds = cfg.steps.map((s) => `"${s.colId}"`).join(",");
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

      // Sum each step
      const sums: Record<string, number> = {};
      cfg.steps.forEach((s) => { sums[s.colId] = 0; });
      allItems.forEach((item) => {
        (item.column_values || []).forEach((cv: any) => {
          if (cv.id in sums) sums[cv.id] += parseFloat(cv.text || "0") || 0;
        });
      });

      const firstVal = cfg.steps.length > 0 ? (sums[cfg.steps[0].colId] || 1) : 1;
      const computed: FunnelStep[] = cfg.steps.map((s, i) => {
        const val = sums[s.colId] || 0;
        const prevVal = i > 0 ? (sums[cfg.steps[i - 1].colId] || 1) : firstVal;
        return {
          label: s.label || s.colId,
          value: val,
          color: s.color,
          pctOfFirst: firstVal > 0 ? (val / firstVal) * 100 : 0,
          pctOfPrev: prevVal > 0 ? (val / prevVal) * 100 : 0,
        };
      });

      setSteps(computed);
      setPhase("ready");
    } catch (e: any) {
      setError(e?.message || "Error al cargar datos");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (phase === "loading" && monday && boardId && config) {
      fetchAndBuild(monday, boardId, config);
    }
  }, [phase, monday, boardId, config, fetchAndBuild]);

  // Save config
  const saveConfig = async () => {
    if (draft.length < 2) { alert("Añade al menos 2 pasos."); return; }
    if (draft.some((s) => !s.colId)) { alert("Selecciona una columna para cada paso."); return; }
    const cfg: Config = { steps: draft };
    await monday.storage.instance.setItem(STORAGE_KEY, JSON.stringify(cfg));
    setConfig(cfg);
    setPhase("loading");
  };

  const resetConfig = async () => {
    await monday.storage.instance.deleteItem(STORAGE_KEY);
    setConfig(null);
    setDraft([
      { colId: "", label: "", color: PALETTE[0] },
      { colId: "", label: "", color: PALETTE[1] },
    ]);
    setPhase("setup");
  };

  const addStep = () => {
    if (draft.length >= 8) return;
    setDraft((d) => [...d, { colId: "", label: "", color: PALETTE[d.length % PALETTE.length] }]);
  };

  const removeStep = (i: number) => {
    if (draft.length <= 2) return;
    setDraft((d) => d.filter((_, idx) => idx !== i));
  };

  const updateStep = (i: number, field: keyof StepDraft, value: string) => {
    setDraft((d) => d.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    setDraft((d) => {
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const numericCols = columns.filter((c) => c.type === "numbers" || c.type === "formula");

  // ── Renders ──────────────────────────────────

  if (phase === "init") return <Loader msg="Conectando con Monday..." />;
  if (phase === "loading") return <Loader msg="Calculando funnel..." />;
  if (phase === "error") return <ErrorMsg msg={error} />;

  if (phase === "setup") {
    return (
      <div style={s.container}>
        <div style={s.setupHeader}>
          <p style={s.setupTitle}>Configura el funnel</p>
          <p style={s.setupSub}>Define los pasos del funnel, asigna una columna numérica a cada uno y ordénalos como quieras.</p>
        </div>

        {draft.map((step, i) => (
          <div key={i} style={s.stepRow}>
            <div style={s.stepNum}>{i + 1}</div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, gap: 6 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  style={{ ...s.input, flex: 1 }}
                  placeholder="Nombre del paso"
                  value={step.label}
                  onChange={(e) => updateStep(i, "label", e.target.value)}
                />
                <input
                  type="color"
                  value={step.color}
                  onChange={(e) => updateStep(i, "color", e.target.value)}
                  style={s.colorPicker}
                  title="Color"
                />
              </div>
              <select
                style={s.select}
                value={step.colId}
                onChange={(e) => updateStep(i, "colId", e.target.value)}
              >
                <option value="">— Selecciona columna numérica —</option>
                {numericCols.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </div>

            <div style={s.stepActions}>
              <button style={s.iconBtn} onClick={() => moveStep(i, -1)} disabled={i === 0} title="Subir">↑</button>
              <button style={s.iconBtn} onClick={() => moveStep(i, 1)} disabled={i === draft.length - 1} title="Bajar">↓</button>
              <button style={{ ...s.iconBtn, color: "#e2445c" }} onClick={() => removeStep(i)} disabled={draft.length <= 2} title="Eliminar">✕</button>
            </div>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={s.btnSecondary} onClick={addStep} disabled={draft.length >= 8}>+ Añadir paso</button>
          <button style={s.btnPrimary} onClick={saveConfig}>Generar funnel ↗</button>
        </div>
      </div>
    );
  }

  // Ready — paint funnel
  const maxVal = steps[0]?.value || 1;

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div style={s.headerTitle}>Funnel de conversión</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={s.btnSmall} onClick={() => monday && boardId && config && fetchAndBuild(monday, boardId, config)} title="Actualizar">↻</button>
          <button style={s.btnSmall} onClick={resetConfig} title="Configurar">⚙</button>
        </div>
      </div>

      {/* Funnel chart */}
      <div style={{ margin: "16px 0" }}>
        {steps.map((step, i) => {
          const widthPct = maxVal > 0 ? Math.max((step.value / maxVal) * 100, 8) : 8;
          const isLast = i === steps.length - 1;
          return (
            <div key={i} style={{ marginBottom: isLast ? 0 : 2 }}>
              {/* Bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                <div style={{ width: 80, fontSize: 11, color: "#676879", textAlign: "right" as const, flexShrink: 0 }}>
                  {step.label}
                </div>
                <div style={{ flex: 1, position: "relative" as const, height: 36 }}>
                  {/* Background track */}
                  <div style={{ position: "absolute" as const, inset: 0, background: "#f0f0f0", borderRadius: 4 }} />
                  {/* Filled bar — centered trapezoid feel */}
                  <div style={{
                    position: "absolute" as const,
                    left: `${(100 - widthPct) / 2}%`,
                    width: `${widthPct}%`,
                    top: 0, bottom: 0,
                    background: step.color,
                    borderRadius: 4,
                    transition: "width 0.4s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap" as const }}>
                      {fmtNum(step.value)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Conversion arrow between steps */}
              {!isLast && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
                  <div style={{ width: 80, flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "flex", justifyContent: "center", fontSize: 11, color: "#676879" }}>
                    ↓ {fmtPct(steps[i + 1].pctOfPrev)} del paso anterior
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary table */}
      <div style={s.sectionLabel}>Detalle</div>
      <div style={{ overflowX: "auto" }}>
        <table style={s.table}>
          <thead>
            <tr>
              {["Paso", "Valor", "% sobre total", "% sobre anterior"].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {steps.map((step, i) => (
              <tr key={i} style={i % 2 === 0 ? { background: "#fafafa" } : {}}>
                <td style={s.td}>
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: step.color, marginRight: 6 }} />
                  {step.label}
                </td>
                <td style={{ ...s.td, textAlign: "right" as const, fontWeight: 500 }}>{fmtNum(step.value)}</td>
                <td style={{ ...s.td, textAlign: "right" as const, color: step.color, fontWeight: 500 }}>{fmtPct(step.pctOfFirst)}</td>
                <td style={{ ...s.td, textAlign: "right" as const, color: "#676879" }}>
                  {i === 0 ? "—" : fmtPct(step.pctOfPrev)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  container: { padding: 16, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#323338", fontSize: 14 },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  headerTitle: { fontSize: 15, fontWeight: 600 },
  setupHeader: { marginBottom: 16 },
  setupTitle: { fontSize: 15, fontWeight: 600, marginBottom: 4 },
  setupSub: { fontSize: 12, color: "#676879" },
  stepRow: { display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, padding: 10, background: "#f6f7fb", borderRadius: 8 },
  stepNum: { width: 24, height: 24, borderRadius: "50%", background: "#0073ea", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, flexShrink: 0, marginTop: 4 },
  stepActions: { display: "flex", flexDirection: "column" as const, gap: 4, flexShrink: 0 },
  iconBtn: { width: 26, height: 26, border: "1px solid #c3c6d4", background: "#fff", borderRadius: 4, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  input: { padding: "6px 10px", borderRadius: 6, border: "1px solid #c3c6d4", fontSize: 13, background: "#fff" },
  select: { width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #c3c6d4", fontSize: 13, background: "#fff" },
  colorPicker: { width: 32, height: 32, border: "1px solid #c3c6d4", borderRadius: 6, cursor: "pointer", padding: 2 },
  btnPrimary: { flex: 1, padding: "8px 16px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 },
  btnSecondary: { padding: "8px 14px", background: "#fff", color: "#323338", border: "1px solid #c3c6d4", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  btnSmall: { padding: "4px 10px", border: "1px solid #c3c6d4", background: "#fff", borderRadius: 4, cursor: "pointer", fontSize: 13 },
  sectionLabel: { fontSize: 11, color: "#676879", textTransform: "uppercase" as const, letterSpacing: ".06em", marginBottom: 8 },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 12 },
  th: { textAlign: "left" as const, padding: "6px 10px", background: "#f6f7fb", color: "#676879", fontWeight: 500, borderBottom: "1px solid #e6e9ef" },
  td: { padding: "6px 10px", borderBottom: "1px solid #f0f0f0" },
};
