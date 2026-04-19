import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  detectTrend,
  findSRZones,
  nearestHeadingZone,
  type Kline,
} from "@/lib/ta";

const TIMEFRAMES: { tf: string; bybit: string; limit: number }[] = [
  { tf: "5m", bybit: "5", limit: 500 },
  { tf: "15m", bybit: "15", limit: 500 },
  { tf: "1h", bybit: "60", limit: 500 },
  { tf: "4h", bybit: "240", limit: 400 },
  { tf: "1d", bybit: "D", limit: 300 },
];

const TOP_N = 100;
const CONCURRENCY = 12;

type Ticker = { symbol: string; turnover24h: number; lastPrice: number };

async function getTopSymbols(): Promise<Ticker[]> {
  const res = await fetch(
    "https://api.bybit.com/v5/market/tickers?category=linear"
  );
  if (!res.ok) throw new Error(`Bybit tickers HTTP ${res.status}`);
  const json = (await res.json()) as {
    result: { list: Array<Record<string, string>> };
  };
  return json.result.list
    .filter((t) => t.symbol.endsWith("USDT"))
    .map((t) => ({
      symbol: t.symbol,
      turnover24h: parseFloat(t.turnover24h),
      lastPrice: parseFloat(t.lastPrice),
    }))
    .filter((t) => Number.isFinite(t.turnover24h) && t.turnover24h > 0)
    .sort((a, b) => b.turnover24h - a.turnover24h)
    .slice(0, TOP_N);
}

async function getKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`kline ${symbol} ${interval} HTTP ${res.status}`);
  const json = (await res.json()) as {
    result: { list: string[][] };
  };
  // Bybit returns newest first — reverse to chronological
  return json.result.list
    .map((row) => ({
      open: parseFloat(row[1]),
      high: parseFloat(row[2]),
      low: parseFloat(row[3]),
      close: parseFloat(row[4]),
      volume: parseFloat(row[5]),
    }))
    .reverse();
}

function multiTfConfluence(
  perTf: Record<string, ReturnType<typeof findSRZones>>,
  level: number
): number {
  let count = 0;
  for (const zones of Object.values(perTf)) {
    if (zones.some((z) => Math.abs(z.level - level) / level < 0.005)) count++;
  }
  return count;
}

async function scanSymbol(ticker: Ticker) {
  const rows: any[] = [];
  const perTfZones: Record<string, ReturnType<typeof findSRZones>> = {};
  const klinesByTf: Record<string, Kline[]> = {};

  // Fetch all timeframes for this symbol
  for (const tfDef of TIMEFRAMES) {
    try {
      const k = await getKlines(ticker.symbol, tfDef.bybit, tfDef.limit);
      if (k.length < 60) continue;
      klinesByTf[tfDef.tf] = k;
      const last = k[k.length - 1];
      const zones = findSRZones(k, last.close, {
        tolerancePct: 0.004,
        minTouches: 5,
        lookback: 3,
      });
      perTfZones[tfDef.tf] = zones;
    } catch {
      // Skip failures silently
    }
  }

  for (const tfDef of TIMEFRAMES) {
    const k = klinesByTf[tfDef.tf];
    const zones = perTfZones[tfDef.tf];
    if (!k || !zones) continue;
    const last = k[k.length - 1];
    const lastDir: "up" | "down" = last.close >= last.open ? "up" : "down";
    const trend = detectTrend(k);

    // Filter to "very strong": touches >= 5 AND volume node (top 20% volumeScore among zones)
    if (zones.length === 0) continue;
    const volThreshold =
      zones.map((z) => z.volumeScore).sort((a, b) => b - a)[
        Math.floor(zones.length * 0.2)
      ] || 0;
    const strongZones = zones.filter(
      (z) => z.touches >= 5 && z.volumeScore >= volThreshold
    );
    if (strongZones.length === 0) continue;

    const heading = nearestHeadingZone(strongZones, last.close, lastDir);
    if (!heading) continue;

    const confluence = multiTfConfluence(perTfZones, heading.level);
    // Bonus: confluence across timeframes
    const finalStrength = Math.min(100, heading.strength + (confluence - 1) * 8);

    rows.push({
      symbol: ticker.symbol,
      timeframe: tfDef.tf,
      current_price: last.close,
      sr_level: heading.level,
      sr_type: heading.type,
      sr_touches: heading.touches,
      sr_distance_pct: ((heading.level - last.close) / last.close) * 100,
      sr_strength: finalStrength,
      trend_state: trend.state,
      trend_direction: trend.direction,
      trend_score: trend.score,
      adx: trend.adxValue,
      volume_24h: ticker.turnover24h,
      heading_toward: true,
      updated_at: new Date().toISOString(),
    });
  }
  return rows;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results.push(await fn(items[idx]));
      } catch {
        // skip
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export const Route = createFileRoute("/hooks/scan-bybit")({
  server: {
    handlers: {
      POST: async () => {
        const runStart = new Date().toISOString();
        const { data: run } = (await supabaseAdmin
          .from("scanner_runs" as any)
          .insert({ started_at: runStart, status: "running" })
          .select()
          .single()) as { data: { id: string } | null };

        try {
          const tickers = await getTopSymbols();
          const allRows = await runWithConcurrency(tickers, CONCURRENCY, scanSymbol);
          const flat = allRows.flat();

          if (flat.length > 0) {
            // Upsert in chunks
            for (let i = 0; i < flat.length; i += 200) {
              const chunk = flat.slice(i, i + 200);
              await supabaseAdmin
                .from("scanner_results" as any)
                .upsert(chunk, { onConflict: "symbol,timeframe" });
            }
          }

          if (run) {
            await supabaseAdmin
              .from("scanner_runs" as any)
              .update({
                finished_at: new Date().toISOString(),
                symbols_scanned: tickers.length,
                status: "ok",
              })
              .eq("id", run.id);
          }

          return Response.json({
            ok: true,
            symbols: tickers.length,
            rows: flat.length,
          });
        } catch (err: any) {
          if (run) {
            await supabaseAdmin
              .from("scanner_runs" as any)
              .update({
                finished_at: new Date().toISOString(),
                status: "error",
                error: String(err?.message || err),
              })
              .eq("id", run.id);
          }
          return new Response(
            JSON.stringify({ ok: false, error: String(err?.message || err) }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
      GET: async () => {
        // Allow manual trigger via GET for convenience
        return new Response(
          "Use POST to trigger scan. Cron runs every 5 minutes.",
          { status: 200 }
        );
      },
    },
  },
});