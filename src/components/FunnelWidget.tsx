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
  label: string; value: number;
  pctOfFirst: number; pctOfPrev: number; color: string;
}

const COLORS = ["#ffcb00", "#579bfc", "#a358df", "#00c875", "#e2445c", "#ff642e"];

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

function fmtNum(n: number): string { return new Intl.NumberFormat("es-ES").format(Math.round(n)); }
function fmtPct(n: number): string { return n.toFixed(1).replace(".", ",") + "%"; }

export default function FunnelWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [phase, setPhase] = useState<"init" | "no-settings" | "loading" | "ready" | "error">("init");
  const [error, setError] = useState("");
  const [isDark, setIsDark] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [containerW, setContainerW] = useState(500);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerW(e.contentRect.width || 500);
    });
    ro.observe(containerRef.current);
    setContainerW(containerRef.current.offsetWidth || 500);
    return () => ro.disconnect();
  }, []);

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

  const getConfigs = useCallback((s: Settings) =>
    [1, 2, 3, 4, 5, 6].map((n, i) => ({
      col: extractColId((s as any)[`step${n}_col`]),
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
      const computed: FunnelStep[] = configs.map((c, i) => {
        const val = sums[c.col!] || 0;
        const prev = i > 0 ? (sums[configs[i - 1].col!] || 1) : first;
        return { label: c.label, value: val, color: c.color, pctOfFirst: first > 0 ? (val / first) * 100 : 0, pctOfPrev: prev > 0 ? (val / prev) * 100 : 0 };
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
  const gridLine = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";

  // SVG layout
  const PAD = 16;
  const SVG_W = Math.max(containerW - PAD * 2, 100);
  const CHART_H = 160;
  const TOP_PAD = 28;
  const LABEL_H = 28;
  const SVG_H = TOP_PAD + CHART_H + LABEL_H + 8;
  const n = steps.length || 1;
  const STEP_W = SVG_W / n;
  const BAR_W = Math.max(Math.min(STEP_W * 0.55, 80), 20);
  const CONN_W = STEP_W - BAR_W;
  const maxVal = steps[0]?.value || 1;
  const firstVal = steps[0]?.value || 0;
  const lastVal = steps[steps.length - 1]?.value || 0;
  const totalConversion = firstVal > 0 ? (lastVal / firstVal) * 100 : 0;

  if (phase === "init" || phase === "loading") {
    return (
      <div ref={containerRef} style={{ background: bg, width: "100%", height: "100%", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {!isExporting && (
          <>
            <div style={{ width: 24, height: 24, border: `3px solid ${textMuted}`, borderTop: "3px solid #579bfc", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </>
        )}
      </div>
    );
  }

  if (phase === "no-settings" || phase === "error") {
    return (
      <div ref={containerRef} style={{ background: bg, width: "100%", height: "100%", minHeight: 200, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" as const, fontFamily: FONT }}>
        {!isExporting && (
          <>
            <p style={{ color: textPrimary, fontSize: 14, fontWeight: 500, margin: "0 0 6px" }}>{phase === "error" ? "Error al cargar" : "Configura el funnel"}</p>
            <p style={{ color: textMuted, fontSize: 12, margin: "0 0 16px", maxWidth: 220, lineHeight: 1.5 }}>{phase === "error" ? error : "Selecciona al menos 2 columnas numéricas desde el panel de ajustes."}</p>
            <button onClick={openSettings} style={{ fontFamily: FONT, padding: "6px 18px", background: "#0073ea", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>Abrir ajustes</button>
          </>
        )}
      </div>
    );
  }

  const configs = getConfigs(settings);

  const svgContent = (
    <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ display: "block", overflow: "visible" }}>
      {steps.map((step, i) => {
        const barH = maxVal > 0 ? Math.max((step.value / maxVal) * CHART_H, 6) : 6;
        const barBottom = TOP_PAD + CHART_H;
        const barTop = barBottom - barH;
        const stepLeft = i * STEP_W;
        const barLeft = stepLeft + CONN_W / 2;
        const barCx = barLeft + BAR_W / 2;
        const nextStep = steps[i + 1];
        const nextBarH = nextStep ? Math.max((nextStep.value / maxVal) * CHART_H, 6) : 0;
        const nextBarTop = barBottom - nextBarH;
        const nextStepLeft = (i + 1) * STEP_W;
        const nextBarLeft = nextStepLeft + CONN_W / 2;

        return (
          <g key={i}>
            {nextStep && (
              <polygon
                points={`${barLeft + BAR_W},${barTop} ${nextBarLeft},${nextBarTop} ${nextBarLeft},${barBottom} ${barLeft + BAR_W},${barBottom}`}
                fill={step.color} opacity="0.2"
              />
            )}
            <rect x={barLeft} y={barTop} width={BAR_W} height={barH} fill={step.color} rx="3" />
            <text x={barCx} y={barTop - 6} textAnchor="middle" fill={textPrimary} fontSize="11" fontWeight="600" fontFamily={FONT}>{fmtNum(step.value)}</text>
            {nextStep && (
              <text x={barLeft + BAR_W + CONN_W / 2} y={Math.min(barTop, nextBarTop) - 6} textAnchor="middle" fill={textMuted} fontSize="9" fontFamily={FONT}>{fmtPct(steps[i + 1].pctOfPrev)}</text>
            )}
            <text x={barCx} y={barBottom + 16} textAnchor="middle" fill={textMuted} fontSize="11" fontFamily={FONT}>
              {step.label.length > 10 ? step.label.substring(0, 9) + "…" : step.label}
            </text>
          </g>
        );
      })}
      <line x1="0" y1={TOP_PAD + CHART_H} x2={SVG_W} y2={TOP_PAD + CHART_H} stroke={gridLine} strokeWidth="1" />
    </svg>
  );

  const footer = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 6, marginTop: 6, paddingTop: 8, borderTop: `0.5px solid ${gridLine}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: textMuted }}>Conversión total:</span>
        <span style={{ fontSize: 18, fontWeight: 600, color: "#00c875", letterSpacing: "-0.01em" }}>{fmtPct(totalConversion)}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
        {steps.map((step, i) => {
          const color = configs[i]?.color || COLORS[i] || "#579bfc";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 3, background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", borderRadius: 4, padding: "2px 7px" }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: color, display: "inline-block" }} />
              <span style={{ fontSize: 11, fontWeight: 600, color }}>{fmtNum(step.value)}</span>
              {i > 0 && <span style={{ fontSize: 10, color: textMuted }}>({fmtPct(step.pctOfPrev)})</span>}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={containerRef} style={{ background: bg, width: "100%", height: "100%", fontFamily: FONT, padding: `12px ${PAD}px 10px`, boxSizing: "border-box" as const }}>
      {svgContent}
      {footer}
    </div>
  );
}
