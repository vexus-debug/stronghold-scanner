import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Loader2, Minus, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  detectTrend,
  findSRZones,
  nearestHeadingZone,
  sharpTurnScore,
  shortTermDirection,
  type Kline,
  type SRZone,
} from "@/lib/ta";

const TIMEFRAMES = [
  { tf: "5m", bybit: "5", limit: 500 },
  { tf: "15m", bybit: "15", limit: 500 },
  { tf: "1h", bybit: "60", limit: 500 },
  { tf: "4h", bybit: "240", limit: 400 },
  { tf: "1d", bybit: "D", limit: 300 },
] as const;

type ZoneOut = SRZone & { sharpTurnPct: number; distancePct: number };
type TfAnalysis = {
  tf: string;
  currentPrice: number;
  direction: "up" | "down" | "neutral";
  trend: ReturnType<typeof detectTrend>;
  zones: ZoneOut[];
  heading: ZoneOut | null;
};

const fetchSymbolAnalysis = createServerFn({ method: "POST" })
  .inputValidator((d: { symbol: string }) => d)
  .handler(async ({ data }) => {
    const { symbol } = data;
    const out: TfAnalysis[] = [];
    for (const tfDef of TIMEFRAMES) {
      const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${tfDef.bybit}&limit=${tfDef.limit}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = (await res.json()) as { result: { list: string[][] } };
      const klines: Kline[] = json.result.list
        .map((r) => ({
          open: parseFloat(r[1]),
          high: parseFloat(r[2]),
          low: parseFloat(r[3]),
          close: parseFloat(r[4]),
          volume: parseFloat(r[5]),
        }))
        .reverse();
      if (klines.length < 60) continue;
      const last = klines[klines.length - 1];
      const dir = shortTermDirection(klines, 5);
      const trend = detectTrend(klines);
      const zones = findSRZones(klines, last.close, {
        tolerancePct: 0.004,
        minTouches: 4,
        lookback: 3,
      });
      const enriched: ZoneOut[] = zones.map((z) => ({
        ...z,
        sharpTurnPct: sharpTurnScore(klines, z.level),
        distancePct: ((z.level - last.close) / last.close) * 100,
      }));
      const heading = nearestHeadingZone(zones, last.close, dir, klines);
      const headingOut = heading
        ? enriched.find((z) => z.level === heading.level) ?? null
        : null;
      out.push({
        tf: tfDef.tf,
        currentPrice: last.close,
        direction: dir,
        trend,
        zones: enriched,
        heading: headingOut,
      });
    }
    return { symbol, analyses: out };
  });

export const Route = createFileRoute("/symbol/$symbol")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.symbol} — Full S/R & Trend Analysis` },
      {
        name: "description",
        content: `Detailed support, resistance, trend and turning points for ${params.symbol} across 5 timeframes.`,
      },
    ],
  }),
  component: SymbolPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-8 text-center">
        <p className="text-bear mb-3">Error: {error.message}</p>
        <Button onClick={() => { router.invalidate(); reset(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="p-8 text-center">
      <p>Symbol not found.</p>
      <Link to="/" className="underline">Go back</Link>
    </div>
  ),
});

function fmtPrice(n: number) {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function SymbolPage() {
  const { symbol } = Route.useParams();
  const [data, setData] = useState<{ analyses: TfAnalysis[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tf, setTf] = useState("1h");

  useEffect(() => {
    setLoading(true);
    fetchSymbolAnalysis({ data: { symbol } })
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [symbol]);

  const current = useMemo(
    () => data?.analyses.find((a) => a.tf === tf) ?? data?.analyses[0],
    [data, tf]
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="size-4" /> Back
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight font-mono">
                {symbol.replace("USDT", "")}
                <span className="text-muted-foreground text-sm">/USDT</span>
              </h1>
              <p className="text-xs text-muted-foreground">Full multi-timeframe analysis</p>
            </div>
          </div>
          {current && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="font-mono font-semibold">${fmtPrice(current.currentPrice)}</p>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {loading || !data || !current ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" /> Analyzing {symbol}…
          </div>
        ) : (
          <>
            <Tabs value={tf} onValueChange={setTf}>
              <TabsList className="bg-card border border-border">
                {data.analyses.map((a) => (
                  <TabsTrigger
                    key={a.tf}
                    value={a.tf}
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
                    {a.tf}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendIcon trend={current.trend} /> Market Structure ({current.tf})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="State" value={current.trend.state.toUpperCase()} />
                  <Row label="Direction" value={current.trend.direction} />
                  <Row label="Trend score" value={`${current.trend.score}/3 signals`} />
                  <Row label="ADX" value={current.trend.adxValue.toFixed(1)} />
                  <Row label="Short-term momentum" value={current.direction === "up" ? "↑ Up" : "↓ Down"} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="size-4 text-primary" /> Heading Toward
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {current.heading ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            current.heading.type === "resistance"
                              ? "border-bear/40 text-bear"
                              : "border-bull/40 text-bull"
                          }
                        >
                          {current.heading.type}
                        </Badge>
                        <span className="font-mono font-semibold">
                          ${fmtPrice(current.heading.level)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          ({current.heading.distancePct > 0 ? "+" : ""}
                          {current.heading.distancePct.toFixed(2)}%)
                        </span>
                      </div>
                      <Row label="Touches" value={current.heading.touches.toString()} />
                      <Row label="Strength" value={`${Math.round(current.heading.strength)}/100`} />
                      <Row
                        label="Avg sharp turn"
                        value={`${current.heading.sharpTurnPct.toFixed(2)}%`}
                      />
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No strong level in current direction.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What to expect</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground leading-relaxed">
                <Expectation a={current} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">All Strong S/R Zones ({current.tf})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium text-right">Level</th>
                        <th className="px-3 py-2 font-medium text-right">Distance</th>
                        <th className="px-3 py-2 font-medium text-center">Touches</th>
                        <th className="px-3 py-2 font-medium text-center">Strength</th>
                        <th className="px-3 py-2 font-medium text-right">Sharp Turn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.zones
                        .slice()
                        .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
                        .map((z, i) => {
                          const isRes = z.type === "resistance";
                          const sharp = z.sharpTurnPct >= 3;
                          return (
                            <tr key={i} className="border-t border-border hover:bg-muted/30">
                              <td className="px-3 py-2">
                                <Badge
                                  variant="outline"
                                  className={isRes ? "border-bear/40 text-bear" : "border-bull/40 text-bull"}
                                >
                                  {isRes ? <ArrowUpRight className="size-3 mr-1" /> : <ArrowDownRight className="size-3 mr-1" />}
                                  {z.type}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-right font-mono">${fmtPrice(z.level)}</td>
                              <td className={`px-3 py-2 text-right font-mono ${isRes ? "text-bear" : "text-bull"}`}>
                                {z.distancePct > 0 ? "+" : ""}{z.distancePct.toFixed(2)}%
                              </td>
                              <td className="px-3 py-2 text-center font-mono">{z.touches}</td>
                              <td className="px-3 py-2 text-center font-mono">{Math.round(z.strength)}</td>
                              <td className="px-3 py-2 text-right">
                                <span className={`font-mono ${sharp ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                                  {z.sharpTurnPct.toFixed(2)}%
                                  {sharp && <Zap className="inline size-3 ml-1" />}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      {current.zones.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                            No strong zones found on this timeframe.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Multi-Timeframe Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">TF</th>
                        <th className="px-3 py-2 font-medium">Trend</th>
                        <th className="px-3 py-2 font-medium">Heading</th>
                        <th className="px-3 py-2 font-medium text-right">Level</th>
                        <th className="px-3 py-2 font-medium text-right">Dist</th>
                        <th className="px-3 py-2 font-medium text-right">Sharp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.analyses.map((a) => (
                        <tr key={a.tf} className="border-t border-border">
                          <td className="px-3 py-2 font-mono font-medium">{a.tf}</td>
                          <td className="px-3 py-2"><TrendIcon trend={a.trend} /></td>
                          <td className="px-3 py-2">
                            {a.heading ? (
                              <Badge variant="outline" className={a.heading.type === "resistance" ? "border-bear/40 text-bear" : "border-bull/40 text-bull"}>
                                {a.heading.type}
                              </Badge>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{a.heading ? `$${fmtPrice(a.heading.level)}` : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {a.heading ? `${a.heading.distancePct > 0 ? "+" : ""}${a.heading.distancePct.toFixed(2)}%` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {a.heading ? `${a.heading.sharpTurnPct.toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function TrendIcon({ trend }: { trend: ReturnType<typeof detectTrend> }) {
  if (trend.state === "ranging") {
    return (
      <Badge variant="outline" className="border-neutral/40 text-neutral gap-1">
        <Minus className="size-3" /> Ranging
      </Badge>
    );
  }
  const up = trend.direction === "up";
  return (
    <Badge variant="outline" className={`gap-1 ${up ? "border-bull/40 text-bull" : "border-bear/40 text-bear"}`}>
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "Trend ↑" : "Trend ↓"}
    </Badge>
  );
}

function Expectation({ a }: { a: TfAnalysis }) {
  if (!a.heading) {
    return <p>No clear strong level in the current direction. Price may chop sideways until a level forms.</p>;
  }
  const dir = a.heading.type === "resistance" ? "up" : "down";
  const sharp = a.heading.sharpTurnPct;
  const trending = a.trend.state === "trending";
  const aligned = trending && a.trend.direction === dir;

  return (
    <div className="space-y-2">
      <p>
        Price is heading <strong className={dir === "up" ? "text-bull" : "text-bear"}>{dir}</strong>{" "}
        toward a <strong>{a.heading.type}</strong> at{" "}
        <span className="font-mono text-foreground">${fmtPrice(a.heading.level)}</span>{" "}
        ({a.heading.distancePct > 0 ? "+" : ""}{a.heading.distancePct.toFixed(2)}% away).
      </p>
      <p>
        This level has <strong>{a.heading.touches} touches</strong> and a strength of{" "}
        <strong>{Math.round(a.heading.strength)}/100</strong>. Historically it has produced{" "}
        average reversals of <strong>{sharp.toFixed(2)}%</strong>
        {sharp >= 3 ? " — a known sharp-turn zone." : "."}
      </p>
      <p className="text-foreground">
        {aligned
          ? `Trend is aligned with the move (${a.trend.direction} ${a.trend.score}/3, ADX ${a.trend.adxValue.toFixed(0)}). Expect the level to be tested with conviction; a clean break could continue the trend, otherwise a sharp rejection of ${sharp.toFixed(1)}% is likely.`
          : a.trend.state === "ranging"
          ? `Market is ranging (ADX ${a.trend.adxValue.toFixed(0)}). The level is more likely to hold — expect a reversal of ~${sharp.toFixed(1)}% rather than a breakout.`
          : `Trend (${a.trend.direction}) is against this move. Approach is likely a counter-trend pullback — high probability of rejection at the level.`}
      </p>
    </div>
  );
}
