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
  color: string;
  pctOfFirst: number;
  pctOfPrev: number;
}

const COLORS = ["#0073ea", "#00c875", "#e2445c", "#ff7575", "#a25ddc", "#ff642e"];

function fmtNum(n: number): string {
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
      sdk.get("settings").then((res: any) => { if (isMounted.current) setSettings(res?.data || {}); });
      sdk.listen("settings", (res: any) => { if (isMounted.current) setSettings(res?.data || {}); });
    });
    return () => { isMounted.current = false; };
  }, []);

  const getConfigs = useCallback((s: Settings) =>
    [1, 2, 3, 4, 5, 6].map((n, i) => ({
      col: (s as any)[`step${n}_col`] as string | undefined,
      label: ((s as any)[`step${n}_label`] as string) || `Paso ${n}`,
      color: COLORS[i],
    })).filter((x) => !!x.col), []);

  const fetchAndBuild = useCallback(async (sdk: any, bid: string, cfg: Settings) => {
    const configs = getConfigs(cfg);
    if (configs.length < 2) { setPhase("no-settings"); return; }
    setPhase("loading");
    try {
      const ids = configs.map((c) => `"${c.col}"`).join(",");
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

      const sums: Record<string, number> = {};
      configs.forEach((c) => { sums[c.col!] = 0; });
      all.forEach((item) => {
        (item.column_values || []).forEach((cv: any) => {
          if (cv.id in sums) sums[cv.id] += parseFloat(cv.text || "0") || 0;
        });
      });

      const first = sums[configs[0].col!] || 1;
      const computed = configs.map((c, i) => {
        const val = sums[c.col!] || 0;
        const prev = i > 0 ? (sums[configs[i - 1].col!] || 1) : first;
        return {
          label: c.label, value: val, color: c.color,
          pctOfFirst: first > 0 ? (val / first) * 100 : 0,
          pctOfPrev: prev > 0 ? (val / prev) * 100 : 0,
        };
      });

      if (isMounted.current) { setSteps(computed); setPhase("ready"); }
    } catch (e: any) { if (isMounted.current) { setError(e?.message || "Error"); setPhase("error"); } }
  }, [getConfigs]);

  useEffect(() => { if (monday && boardId) fetchAndBuild(monday, boardId, settings); }, [monday, boardId, settings, fetchAndBuild]);

  const openSettings = () => { if (monday) monday.execute("openSettings"); };

  if (phase === "init" || phase === "loading") {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (phase === "no-settings" || phase === "error") {
    return (
      <div style={s.center}>
        <svg width="60" height="54" viewBox="0 0 60 54" style={{ marginBottom: 12 }}>
          <polygon points="4,2 56,2 48,18 12,18" fill="#e6e9ef" />
          <polygon points="12,20 48,20 42,36 18,36" fill="#d0d4e4" />
          <polygon points="18,38 42,38 38,52 22,52" fill="#c3c6d4" />
        </svg>
        <p style={s.emptyTitle}>{phase === "error" ? "Error al cargar" : "Configura el funnel"}</p>
        <p style={s.emptySub}>{phase === "error" ? error : "Selecciona al menos 2 columnas numéricas desde el panel de ajustes."}</p>
        <button style={s.openBtn} onClick={openSettings}>Abrir ajustes</button>
      </div>
    );
  }

  // Monday-style SVG funnel
  const STEP_H = 46;
  const ARROW_H = 20;
  const SVG_W = 400;
  const LABEL_W = 90;
  const PCT_W = 50;
  const BAR_W = SVG_W - LABEL_W - PCT_W - 16;
  const BAR_X = LABEL_W + 8;
  const totalH = steps.length * STEP_H + (steps.length - 1) * ARROW_H;
  const maxVal = steps[0]?.value || 1;

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#323338", fontSize: 13, padding: "10px 8px" }}>
      <svg
        width="100%"
        height={totalH}
        viewBox={`0 0 ${SVG_W} ${totalH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", overflow: "visible" }}
      >
        {steps.map((step, i) => {
          const pct = maxVal > 0 ? Math.max(step.value / maxVal, 0.1) : 0.1;
          const nextPct = steps[i + 1] ? Math.max(steps[i + 1].value / maxVal, 0.1) : pct * 0.7;

          const topW = pct * BAR_W;
          const botW = (i < steps.length - 1 ? nextPct : pct * 0.7) * BAR_W;

          const topL = BAR_X + (BAR_W - topW) / 2;
          const topR = topL + topW;
          const y = i * (STEP_H + ARROW_H);

          const botL = BAR_X + (BAR_W - botW) / 2;
          const botR = botL + botW;

          const pts = `${topL},${y} ${topR},${y} ${botR},${y + STEP_H} ${botL},${y + STEP_H}`;
          const cx = BAR_X + BAR_W / 2;
          const cy = y + STEP_H / 2;

          return (
            <g key={i}>
              {/* Trapezoid bar */}
              <polygon points={pts} fill={step.color} />

              {/* Left label */}
              <text
                x={LABEL_W}
                y={cy + 5}
                textAnchor="end"
                fill="#323338"
                fontSize="12"
                fontWeight="500"
                fontFamily="-apple-system, sans-serif"
              >
                {step.label.length > 10 ? step.label.substring(0, 10) + "…" : step.label}
              </text>

              {/* Value inside bar */}
              <text
                x={cx}
                y={cy + 5}
                textAnchor="middle"
                fill="white"
                fontSize="13"
                fontWeight="700"
                fontFamily="-apple-system, sans-serif"
              >
                {fmtNum(step.value)}
              </text>

              {/* % of first (right) */}
              <text
                x={BAR_X + BAR_W + 10}
                y={cy + 5}
                textAnchor="start"
                fill="#676879"
                fontSize="11"
                fontFamily="-apple-system, sans-serif"
              >
                {fmtPct(step.pctOfFirst)}
              </text>

              {/* Arrow + conversion between steps */}
              {i < steps.length - 1 && (
                <g>
                  <polygon
                    points={`${cx - 5},${y + STEP_H + 2} ${cx + 5},${y + STEP_H + 2} ${cx},${y + STEP_H + 12}`}
                    fill={step.color}
                    opacity="0.5"
                  />
                  <text
                    x={cx + 9}
                    y={y + STEP_H + 12}
                    fill="#676879"
                    fontSize="10"
                    fontFamily="-apple-system, sans-serif"
                  >
                    {fmtPct(steps[i + 1].pctOfPrev)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Divider */}
      <div style={{ height: "0.5px", background: "#e6e9ef", margin: "12px 0 10px" }} />

      {/* Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["Paso", "Valor", "% total", "% anterior"].map((h) => (
              <th key={h} style={{ textAlign: h === "Paso" ? "left" : "right", padding: "4px 8px", background: "#f6f7fb", color: "#676879", fontWeight: 500, borderBottom: "1px solid #e6e9ef", fontSize: 11 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {steps.map((step, i) => (
            <tr key={i} style={i % 2 === 0 ? { background: "#fafbff" } : {}}>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: step.color, marginRight: 6, verticalAlign: "middle" }} />
                {step.label}
              </td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontWeight: 500 }}>{fmtNum(step.value)}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "right", color: step.color, fontWeight: 500 }}>{fmtPct(step.pctOfFirst)}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "right", color: "#676879" }}>{i === 0 ? "—" : fmtPct(step.pctOfPrev)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  center: { display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", minHeight: 240, padding: 24, textAlign: "center" as const, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  spinner: { width: 28, height: 28, border: "3px solid #e6e9ef", borderTop: "3px solid #0073ea", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: "#323338", margin: "0 0 6px" },
  emptySub: { fontSize: 12, color: "#676879", margin: "0 0 16px", maxWidth: 240, lineHeight: 1.5 },
  openBtn: { padding: "7px 20px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500 },
};
