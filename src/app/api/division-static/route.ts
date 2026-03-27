import { NextRequest, NextResponse } from "next/server";

const MONDAY_API = "https://api.monday.com/v2";

async function queryMonday(token: string, query: string) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const boardId = searchParams.get("boardId");
  const colA = searchParams.get("colA");
  const colB = searchParams.get("colB");
  const suffix = searchParams.get("suffix") || "";
  const decimals = parseInt(searchParams.get("decimals") || "2", 10);
  const multiply = searchParams.get("multiply") === "1";
  const isDark = searchParams.get("dark") === "1";
  const token = process.env.MONDAY_API_TOKEN || "";

  let formatted = "—";

  if (boardId && colA && colB && token) {
    try {
      const colIds = `"${colA}", "${colB}"`;
      let sumA = 0, sumB = 0;
      let cursor: string | null = null;

      do {
        const q = cursor
          ? `{ boards(ids:[${boardId}]) { items_page(limit:100, cursor:"${cursor}") { cursor items { column_values(ids:[${colIds}]) { id text } } } } }`
          : `{ boards(ids:[${boardId}]) { items_page(limit:100) { cursor items { column_values(ids:[${colIds}]) { id text } } } } }`;

        const data = await queryMonday(token, q);
        const page = data?.data?.boards?.[0]?.items_page;
        if (!page) break;

        for (const item of page.items || []) {
          for (const cv of item.column_values || []) {
            const val = parseFloat(cv.text || "0") || 0;
            if (cv.id === colA) sumA += val;
            if (cv.id === colB) sumB += val;
          }
        }
        cursor = page.cursor || null;
      } while (cursor);

      let result = sumB > 0 ? sumA / sumB : 0;
      if (multiply) result = result * 100;
      formatted = result.toFixed(decimals);
    } catch {
      formatted = "—";
    }
  }

  const color = isDark ? "#d5d8df" : "#323338";
  const bg = isDark ? "#1f2130" : "#ffffff";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@300&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: ${bg};
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  font-family: 'Figtree', -apple-system, sans-serif;
}
.num {
  font-size: clamp(40px, 10vw, 72px);
  font-weight: 300;
  color: ${color};
  letter-spacing: -0.02em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
</style>
</head>
<body>
  <div style="display:flex;align-items:baseline;gap:0.05em">
    <span class="num">${formatted}</span>
    ${suffix ? `<span class="num">${suffix}</span>` : ""}
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html", "X-Frame-Options": "ALLOWALL", "Content-Security-Policy": "frame-ancestors *" },
  });
}
