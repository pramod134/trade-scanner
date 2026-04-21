import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { runScanner, getHTFBias, buildSampleRows } from "./src/shared/scannerCore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const app = express();
const PORT = Number(process.env.PORT || 3000);
const CACHE_TTL_MS = Number(process.env.SCANNER_CACHE_MS || 30000);
const isProd = process.env.NODE_ENV === "production";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseEnv = Boolean(supabaseUrl && supabaseKey);

const supabase = hasSupabaseEnv ? createClient(supabaseUrl, supabaseKey) : null;
const dashboardCache = new Map();

function getCacheKey(symbol) {
  return symbol.trim().toUpperCase();
}

async function fetchRows(symbol) {
  if (!supabase) {
    return { rows: buildSampleRows().filter((row) => row.symbol === symbol || symbol === "SPY"), source: "sample-fallback" };
  }

  const { data, error } = await supabase
    .from("tick_tf")
    .select(`
      symbol,
      timeframe,
      last_updated,
      structure_state,
      trend,
      extras,
      last_candle,
      extras_advanced,
      fvgs_lite,
      volume_profile_lite,
      structural_lite,
      liquidity_lite
    `)
    .eq("symbol", symbol)
    .in("timeframe", ["1m", "3m", "5m", "15m", "1h", "1d", "1w"]);

  if (error) throw error;
  return { rows: data ?? [], source: "supabase" };
}

async function buildDashboardPayload(symbol) {
  const key = getCacheKey(symbol);
  const cached = dashboardCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.payload;
  }

  const { rows, source } = await fetchRows(key);
  const signals = runScanner(rows);
  const bias = getHTFBias(rows);
  const payload = {
    symbol: key,
    source,
    rowsFetched: rows.length,
    scannedAt: new Date().toISOString(),
    signals,
    bias,
  };

  dashboardCache.set(key, { cachedAt: Date.now(), payload });
  return payload;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, supabase: hasSupabaseEnv, cacheTtlMs: CACHE_TTL_MS });
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").trim().toUpperCase() || "SPY";
    const payload = await buildDashboardPayload(symbol);
    res.json(payload);
  } catch (error) {
    console.error("Dashboard API failed:", error);
    res.status(500).json({ error: error?.message || "Unable to build dashboard." });
  }
});

if (isProd) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({ ok: true, message: "Server is running. Use Vite dev server for the frontend in development." });
  });
}

app.listen(PORT, () => {
  console.log(`Trade scanner server listening on port ${PORT}`);
});
