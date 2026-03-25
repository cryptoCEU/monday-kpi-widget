"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Settings {
  step1_col?: string; step1_label?: string;
  step2_col?: string; step2_label?: string;
  step3_col?: string; step3_label?: string;
  step4_col?: string; step4_label?: string;
  step5_col?: string; step5_label?: string;
  step6_col?: string; step6_label?: string;
}

interface FunnelStep {
  label: string;
  value: number;
  pctOfFirst: number;
  pctOfPrev: number;
}

// Monday.com brand colors
const STEP_COLORS = [
  "#0073ea", // blue
  "#00c875", // green
  "#e2445c", // red
  "#ff7575", // coral
  "#a25ddc", // purple
  "#ffcb00", // yellow
];

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(".", ",") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".", ",") + "K";
  return new Intl.NumberFormat("es-ES").format(Math.round(n));
}

function fmtPct(n: number): string {
  return n.toFixed(1).replace(".", ",") + "%";
}

export default function FunnelWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [steps, setSteps] = useState<FunnelStep[]>([]);
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

  // 2. Fetch data when settings change
  const fetchAndBuild = useCallback(async (sdk: any, bid: string, cfg: Settings) => {
    // Build step definitions from settings
    const stepDefs = [1, 2, 3, 4, 5, 6]
      .map((n) => ({
        colId: (cfg as any)[`step${n}_col`] as string | undefined,
        label: (cfg as any)[`step${n}_label`] as string | undefined,
        color: STEP_COLORS[n - 1],
      }))
      .filter((s) => s.colId);

    if (stepDefs.length < 2) {
      setPhase("no-settings");
      return;
    }

    setPhase("loading");
    try {
      const colIds = stepDefs.map((s) => `"${s.colId}"`).join(",");
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

      // Sum each column
      const sums: Record<string, number> = {};
      stepDefs.forEach((s) => { sums[s.colId!] = 0; });
      allItems.forEach((item) => {
        (item.column_values || []).forEach((cv: any) => {
          if (cv.id in sums) sums[cv.id] += parseFloat(cv.text || "0") || 0;
        });
      });

      const firstVal = sums[stepDefs[0].colId!] || 1;
      const computed: FunnelStep[] = stepDefs.map((s, i) => {
        const val = sums[s.colId!] || 0;
        const prevVal = i > 0 ? (sums[stepDefs[i - 1].colId!] || 1) : firstVal;
        return {
          label: s.label || `Paso ${i + 1}`,
          value: val,
          pctOfFirst: firstVal > 0 ? (val / firstVal) * 100 : 0,
          pctOfPrev: prevVal > 0 ? (val / prevVal) * 100 : 0,
        };
      });

      if (isMounted.current) {
        setSteps(computed);
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
      fetchAndBuild(monday, boardId, settings);
    }
  }, [monday, boardId, settings, fetchAndBuild]);

  const openSettings = () => monday?.execute("openSettings");

  // ── Renders ──────────────────────────────

  if (phase === "init" || phase === "loading") return <Loader />;

  if (phase === "no-settings") {
    return (
      <div style={s.emptyState}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#c3c6d4" strokeWidth="1.2" style={{ marginBottom: 12 }}>
          <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46" />
        </svg>
        <p style={s.emptyTitle}>Configura el funnel</p>
        <p style={s.emptySub}>Selecciona al menos 2 pasos desde la configuración del widget.</p>
        <button style={s.primaryBtn} onClick={openSettings}>Abrir configuración</button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={s.emptyState}>
        <p style={{ color: "#e2445c", fontSize: 13, marginBottom: 12 }}>⚠ {error}</p>
        <button style={s.primaryBtn} onClick={openSettings}>Revisar configuración</button>
      </div>
    );
  }

  // Ready — Monday-style funnel
  const maxVal = steps[0]?.value || 1;
  const MIN_WIDTH_PCT = 15;

  return (
    <div style={s.container}>
      {/* Funnel */}
      <div style={{ padding: "8px 0 4px" }}>
        {steps.map((step, i) => {
          const widthPct = maxVal > 0
            ? Math.max((step.value / maxVal) * 100, MIN_WIDTH_PCT)
            : MIN_WIDTH_PCT;
          const color = STEP_COLORS[i % STEP_COLORS.length];
          const isLast = i === steps.length - 1;

          return (
            <div key={i}>
              {/* Step bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 0 }}>
                {/* Label left */}
                <div style={s.stepLabel}>{step.label}</div>

                {/* Trapezoid bar — centered */}
                <div style={{ flex: 1, position: "relative" as const, height: 44 }}>
                  {/* Background */}
                  <div style={{ position: "absolute" as const, inset: 0, background: "#f0f4fd", borderRadius: 0 }} />
                  {/* Colored bar */}
                  <div style={{
                    position: "absolute" as const,
                    left: `${(100 - widthPct) / 2}%`,
                    width: `${widthPct}%`,
                    top: 0,
                    bottom: 0,
                    background: color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "width 0.5s cubic-bezier(.4,0,.2,1)",
                    clipPath: i === 0
                      ? "none"
                      : "polygon(2% 0%, 98% 0%, 100% 100%, 0% 100%)",
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", whiteSpace: "nowrap" as const, letterSpacing: "0.01em" }}>
                      {fmtNum(step.value)}
                    </span>
                  </div>
                </div>

                {/* Pct right */}
                <div style={s.stepPct}>
                  {i === 0 ? "100%" : fmtPct(step.pctOfFirst)}
                </div>
              </div>

              {/* Conversion between steps */}
              {!isLast && (
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ width: 80, flexShrink: 0 }} />
                  <div style={{ flex: 1, background: "#f0f4fd", height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 10, color: "#676879", letterSpacing: "0.02em" }}>
                      ↓ {fmtPct(steps[i + 1].pctOfPrev)} de conversión
                    </span>
                  </div>
                  <div style={{ width: 52, flexShrink: 0 }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "#e6e9ef", margin: "12px 0 10px" }} />

      {/* Summary table */}
      <div style={{ overflowX: "auto" }}>
        <table style={s.table}>
          <thead>
            <tr>
              {["Paso", "Valor", "% total", "% anterior"].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {steps.map((step, i) => (
              <tr key={i} style={i % 2 === 0 ? { background: "#fafbff" } : {}}>
                <td style={s.td}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: STEP_COLORS[i % STEP_COLORS.length], marginRight: 7, verticalAlign: "middle" }} />
                  {step.label}
                </td>
                <td style={{ ...s.td, textAlign: "right" as const, fontWeight: 500 }}>{fmtNum(step.value)}</td>
                <td style={{ ...s.td, textAlign: "right" as const, color: STEP_COLORS[i % STEP_COLORS.length], fontWeight: 500 }}>{i === 0 ? "100%" : fmtPct(step.pctOfFirst)}</td>
                <td style={{ ...s.td, textAlign: "right" as const, color: "#676879" }}>{i === 0 ? "—" : fmtPct(step.pctOfPrev)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 180 }}>
      <div style={{ width: 28, height: 28, border: "3px solid #e6e9ef", borderTop: "3px solid #0073ea", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { padding: "12px 14px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#323338", fontSize: 13 },
  stepLabel: { width: 80, flexShrink: 0, fontSize: 11, color: "#676879", textAlign: "right" as const, paddingRight: 8, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  stepPct: { width: 44, flexShrink: 0, fontSize: 11, color: "#676879", textAlign: "left" as const, paddingLeft: 8 },
  emptyState: { display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", minHeight: 220, padding: 24, textAlign: "center" as const },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: "#323338", marginBottom: 6 },
  emptySub: { fontSize: 12, color: "#676879", marginBottom: 16, maxWidth: 220, lineHeight: 1.5 },
  primaryBtn: { padding: "8px 20px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 12 },
  th: { textAlign: "left" as const, padding: "5px 8px", background: "#f6f7fb", color: "#676879", fontWeight: 500, borderBottom: "1px solid #e6e9ef", fontSize: 11 },
  td: { padding: "5px 8px", borderBottom: "1px solid #f0f0f0" },
};
