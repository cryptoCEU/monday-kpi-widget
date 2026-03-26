"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface Settings {
  step1_col?: any; step1_label?: string;
  step2_col?: any; step2_label?: string;
  step3_col?: any; step3_label?: string;
  step4_col?: any; step4_label?: string;
  step5_col?: any; step5_label?: string;
  step6_col?: any; step6_label?: string;
}

interface FunnelStep {
  label: string;
  value: number;
  pctOfFirst: number;
  pctOfPrev: number;
}

// Same blue palette as Monday native funnel
const BAR_COLOR = "#4d90fe";
const BAR_COLOR_DIM = "#2d5fa8";
const ARROW_COLOR = "#4d90fe";

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
        const t = res?.data?.theme || "dark";
        setIsDark(t === "dark" || t === "black");
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

  const getConfigs = useCallback((s: Settings) =>
    [1, 2, 3, 4, 5, 6].map((n) => ({
      col: extractColId((s as any)[`step${n}_col`]),
      label: ((s as any)[`step${n}_label`] as string) || `Paso ${n}`,
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
          label: c.label, value: val,
          pctOfFirst: first > 0 ? (val / first) * 100 : 0,
          pctOfPrev: prev > 0 ? (val / prev) * 100 : 0,
        };
      });

      if (isMounted.current) { setSteps(computed); setPhase("ready"); }
    } catch (e: any) {
      if (isMounted.current) { setError(e?.message || "Error"); setPhase("error"); }
    }
  }, [getConfigs]);

  useEffect(() => {
    if (monday && boardId) fetchAndBuild(monday, boardId, settings);
  }, [monday, boardId, settings, fetchAndBuild]);

  const openSettings = () => { if (monday) monday.execute("openSettings"); };

  const FONT = "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const bg = isDark ? "#1f2130" : "#ffffff";
  const textPrimary = isDark ? "#d5d8df" : "#323338";
  const textMuted = isDark ? "#7c84a3" : "#676879";
  const gridLine = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

  if (phase === "init" || phase === "loading") {
    return (
      <div style={{ background: bg, width: "100%", height: "100%", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 24, height: 24, border: `3px solid ${textMuted}`, borderTop: `3px solid ${BAR_COLOR}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (phase === "no-settings" || phase === "error") {
    return (
      <div style={{ background: bg, width: "100%", height: "100%", minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontFamily: FONT }}>
        <svg width="52" height="44" viewBox="0 0 52 44" style={{ marginBottom: 12, opacity: 0.4 }}>
          <rect x="0" y="0" width="10" height="44" rx="2" fill={BAR_COLOR}/>
          <rect x="14" y="8" width="10" height="36" rx="2" fill={BAR_COLOR}/>
          <rect x="28" y="18" width="10" height="26" rx="2" fill={BAR_COLOR}/>
          <rect x="42" y="28" width="10" height="16" rx="2" fill={BAR_COLOR}/>
        </svg>
        <p style={{ color: textPrimary, fontSize: 14, fontWeight: 500, margin: "0 0 6px" }}>
          {phase === "error" ? "Error al cargar" : "Configura el funnel"}
        </p>
        <p style={{ color: textMuted, fontSize: 12, margin: "0 0 16px", maxWidth: 220, lineHeight: 1.5 }}>
          {phase === "error" ? error : "Selecciona al menos 2 columnas numéricas desde el panel de ajustes."}
        </p>
        <button onClick={openSettings} style={{ fontFamily: FONT, padding: "6px 18px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>
          Abrir ajustes
        </button>
      </div>
    );
  }

  const maxVal = steps[0]?.value || 1;
  const CHART_H = 180;
  const firstVal = steps[0]?.value || 0;
  const lastVal = steps[steps.length - 1]?.value || 0;
  const totalConversion = firstVal > 0 ? (lastVal / firstVal) * 100 : 0;

  return (
    <div style={{ background: bg, width: "100%", height: "100%", fontFamily: FONT, padding: "16px 12px 12px", boxSizing: "border-box" }}>
      {/* Chart area */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 0, height: CHART_H, marginBottom: 8, position: "relative" }}>
        {/* Y axis grid lines */}
        {[0, 0.33, 0.66, 1].map((pct, i) => (
          <div key={i} style={{
            position: "absolute",
            left: 0, right: 0,
            bottom: pct * CHART_H,
            borderTop: `1px solid ${gridLine}`,
            pointerEvents: "none",
          }} />
        ))}

        {/* Bars + arrows */}
        {steps.map((step, i) => {
          const barH = maxVal > 0 ? Math.max((step.value / maxVal) * CHART_H, 4) : 4;
          const isLast = i === steps.length - 1;
          const nextStep = steps[i + 1];

          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-end", flex: 1, position: "relative", height: "100%" }}>
              {/* Bar group */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", paddingRight: isLast ? 0 : 2 }}>
                {/* Value on top */}
                <span style={{ fontSize: 11, fontWeight: 600, color: textPrimary, marginBottom: 4, whiteSpace: "nowrap" as const }}>
                  {fmtNum(step.value)}
                </span>

                {/* % of previous (shown between bars) */}
                {i > 0 && (
                  <span style={{
                    position: "absolute",
                    top: CHART_H - barH - 22,
                    left: -18,
                    fontSize: 10,
                    color: textMuted,
                    whiteSpace: "nowrap" as const,
                    zIndex: 2,
                  }}>
                    {fmtPct(step.pctOfPrev)}
                  </span>
                )}

                {/* Bar */}
                <div style={{
                  width: "100%",
                  height: barH,
                  background: `linear-gradient(to bottom, ${BAR_COLOR}, ${BAR_COLOR_DIM})`,
                  borderRadius: "3px 3px 0 0",
                  position: "relative",
                  transition: "height 0.5s ease",
                }} />
              </div>

              {/* Arrow between bars */}
              {!isLast && nextStep && (
                <div style={{
                  width: 16,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  height: "100%",
                  paddingBottom: Math.max((nextStep.value / maxVal) * CHART_H, 4) / 2,
                  flexShrink: 0,
                  zIndex: 1,
                }}>
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <path d="M2 4 L6 8 L10 4" stroke={ARROW_COLOR} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              )}
            </div>
          );
        })}

        {/* Total conversion — right side like Monday */}
        <div style={{
          position: "absolute",
          right: -4,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          pointerEvents: "none",
          paddingLeft: 8,
        }}>
          <svg width="14" height: 40" viewBox="0 0 14 40" style={{ flexShrink: 0 }}>
            <path d="M7 0 L7 40" stroke={BAR_COLOR} strokeWidth="1.5" strokeDasharray="3 3"/>
            <path d="M3 36 L7 40 L11 36" fill={BAR_COLOR}/>
          </svg>
        </div>
      </div>

      {/* X axis labels */}
      <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            flex: 1,
            textAlign: "center",
            fontSize: 11,
            color: textMuted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap" as const,
            paddingRight: i < steps.length - 1 ? 16 : 0,
          }}>
            {step.label}
          </div>
        ))}
      </div>

      {/* Divider */}
      <div style={{ height: "0.5px", background: gridLine, marginBottom: 10 }} />

      {/* Bottom: total conversion + step details */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 8 }}>
        {/* Total conversion */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: textMuted }}>Conversión total:</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#00c875" }}>{fmtPct(totalConversion)}</span>
        </div>

        {/* Step pills */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
          {steps.map((step, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 4,
              background: isDark ? "rgba(77,144,254,0.12)" : "rgba(77,144,254,0.08)",
              borderRadius: 4, padding: "2px 8px",
            }}>
              <span style={{ fontSize: 10, color: textMuted }}>{step.label}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: BAR_COLOR }}>{fmtNum(step.value)}</span>
              {i > 0 && <span style={{ fontSize: 10, color: textMuted }}>({fmtPct(step.pctOfPrev)})</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
