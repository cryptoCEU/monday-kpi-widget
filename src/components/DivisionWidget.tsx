"use client";

import { useEffect, useState, useRef } from "react";

export default function DivisionWidget() {
  const [monday, setMonday] = useState<any>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>({});
  const [result, setResult] = useState<number | null>(null);
  const [phase, setPhase] = useState<"init" | "loading" | "ready" | "error">("init");
  const [debug, setDebug] = useState<string>("");
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
        setDebug(prev => prev + "\nCONTEXT boardId: " + id);
      });

      sdk.get("settings").then((res: any) => {
        if (!isMounted.current) return;
        const s = res?.data || {};
        setSettings(s);
        setDebug(prev => prev + "\nSETTINGS: " + JSON.stringify(s, null, 2));
      });

      sdk.listen("settings", (res: any) => {
        if (!isMounted.current) return;
        const s = res?.data || {};
        setSettings(s);
        setDebug(prev => prev + "\nSETTINGS UPDATE: " + JSON.stringify(s, null, 2));
      });
    });
    return () => { isMounted.current = false; };
  }, []);

  return (
    <div style={{
      fontFamily: "monospace",
      fontSize: 11,
      padding: 12,
      background: "#1a1a2e",
      color: "#00ff88",
      whiteSpace: "pre-wrap" as const,
      wordBreak: "break-all" as const,
      minHeight: 200,
      overflow: "auto",
    }}>
      {debug || "Esperando datos..."}
    </div>
  );
}
