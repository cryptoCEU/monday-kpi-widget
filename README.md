# KPI Widget — Activum
Widget privado de Monday.com que calcula CPL y CVR reales (SUM ÷ SUM) y muestra la evolución mensual.

## Qué hace
- **CPL real**: SUM(Importe gastado) ÷ SUM(Resultados) → 1,71 €
- **CVR real**: SUM(Resultados) ÷ SUM(Clics) × 100 → 14,47 %
- **Evolución mensual**: gráfico de barras con CPL y CVR por mes
- **Tabla de detalle**: breakdown mensual completo
- Se actualiza en tiempo real con los datos del tablero

---

## Instalación (30 min)

### 1. Subir a GitHub
```bash
git init
git add .
git commit -m "KPI Widget"
git remote add origin https://github.com/cryptoCEU/monday-kpi-widget.git
git push -u origin main
```

### 2. Desplegar en Vercel
- Ir a vercel.com → New Project → importar el repo
- Framework: Next.js (detecta automático)
- Deploy → copiar la URL resultante, ej: `https://monday-kpi-widget.vercel.app`

### 3. Crear la App en Monday
1. Ir a https://monday.com/developers
2. "Create App" → nombre: "KPI Widget Activum"
3. En Features → "Add Feature" → tipo: **Dashboard Widget**
4. En la configuración del widget:
   - **Build URL**: `https://monday-kpi-widget.vercel.app`
   - Activar "Use URL as base"
5. Copiar el **App ID** y el **Client ID** (los necesitarás si añades OAuth)

### 4. Instalar la app en tu cuenta
1. Dentro del app builder → "Install" → selecciona tu cuenta
2. Ir a cualquier Dashboard de Monday
3. "Agregar widget" → busca "KPI Widget Activum"
4. Selecciona el tablero LA NUCIA → el widget carga solo

---

## Adaptar a otros tableros
Si necesitas usar el widget en otro tablero, edita las constantes en `src/components/KpiWidget.tsx`:

```typescript
const COL_IMPORTE    = "numeric_mm1swjbd";  // Importe gastado
const COL_RESULTADOS = "numeric_mm1s7a4";   // Resultados (leads)
const COL_CLICS      = "numeric_mm1swt56";  // Clics en enlace
const COL_FECHA      = "date_mm1sf4w9";     // Inicio del informe
```

Cámbia los IDs por los de las columnas del tablero que quieras.

---

## Stack
- Next.js 14 + TypeScript
- monday-sdk-js (acceso a datos del tablero)
- Chart.js + react-chartjs-2 (gráficos)
- Vercel (hosting)
