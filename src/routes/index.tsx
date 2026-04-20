import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, TrendingDown, TrendingUp, Minus, ArrowUpRight, ArrowDownRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bybit S/R Scanner — Strong Levels & Trend Detection" },
      {
        name: "description",
        content:
          "Live Bybit scanner finding the strongest support/resistance the price is heading toward across 5m, 15m, 1h, 4h, and daily timeframes.",
      },
    ],
  }),
  component: Index,
});

type Row = {
  id: string;
  symbol: string;
  timeframe: string;
  current_price: number;
  sr_level: number;
  sr_type: string;
  sr_touches: number;
  sr_distance_pct: number;
  sr_strength: number;
  trend_state: string;
  trend_direction: string;
  trend_score: number;
  adx: number;
  volume_24h: number;
  updated_at: string;
};

const TFS = ["5m", "15m", "1h", "4h", "1d"] as const;

function fmtPrice(n: number) {
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}
function fmtVol(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${(n / 1e3).toFixed(1)}K`;
}

function Index() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tf, setTf] = useState<string>("1h");
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchData = async () => {
    const { data } = await supabase
      .from("scanner_results" as any)
      .select("*")
      .order("sr_distance_pct", { ascending: true })
      .limit(2000);
    if (data) {
      setRows(data as unknown as Row[]);
      setLastUpdate(new Date().toLocaleTimeString());
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 30_000);
    return () => clearInterval(i);
  }, []);

  const triggerScan = async () => {
    setScanning(true);
    try {
      await fetch("/hooks/scan-bybit", { method: "POST" });
      await fetchData();
    } finally {
      setScanning(false);
    }
  };

  const filtered = useMemo(() => {
    return rows
      .filter((r) => r.timeframe === tf)
      .filter((r) => (search ? r.symbol.toLowerCase().includes(search.toLowerCase()) : true))
      .sort((a, b) => Math.abs(a.sr_distance_pct) - Math.abs(b.sr_distance_pct));
  }, [rows, tf, search]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-primary">BYBIT</span> S/R Scanner
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Top 100 by volume · 5 timeframes · Strong S/R = ≥5 touches + volume node
              {lastUpdate && <span className="ml-2">· Updated {lastUpdate}</span>}
            </p>
          </div>
          <Button onClick={triggerScan} disabled={scanning} size="sm" className="gap-2">
            {scanning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {scanning ? "Scanning…" : "Run scan now"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <Tabs value={tf} onValueChange={setTf}>
            <TabsList className="bg-card border border-border">
              {TFS.map((t) => (
                <TabsTrigger key={t} value={t} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Input
            placeholder="Search symbol… (e.g. BTC)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs bg-card border-border"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p>No results yet. Click <strong>Run scan now</strong> to populate the cache.</p>
            <p className="text-xs mt-2">First scan takes ~30–60 seconds for 100 symbols × 5 timeframes.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2.5 font-medium">Symbol</th>
                    <th className="px-3 py-2.5 font-medium text-right">Price</th>
                    <th className="px-3 py-2.5 font-medium">Heading to</th>
                    <th className="px-3 py-2.5 font-medium text-right">Level</th>
                    <th className="px-3 py-2.5 font-medium text-right">Dist %</th>
                    <th className="px-3 py-2.5 font-medium text-center">Touches</th>
                    <th className="px-3 py-2.5 font-medium text-center">Strength</th>
                    <th className="px-3 py-2.5 font-medium">Market</th>
                    <th className="px-3 py-2.5 font-medium text-right">ADX</th>
                    <th className="px-3 py-2.5 font-medium text-right hidden md:table-cell">Vol 24h</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const isRes = r.sr_type === "resistance";
                    return (
                      <tr
                        key={r.id}
                        onClick={() => navigate({ to: "/symbol/$symbol", params: { symbol: r.symbol } })}
                        className="border-t border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <td className="px-3 py-2.5 font-mono font-medium">{r.symbol.replace("USDT", "")}<span className="text-muted-foreground text-xs">/USDT</span></td>
                        <td className="px-3 py-2.5 text-right font-mono">{fmtPrice(Number(r.current_price))}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant="outline" className={isRes ? "border-bear/40 text-bear" : "border-bull/40 text-bull"}>
                            {isRes ? <ArrowUpRight className="size-3 mr-1" /> : <ArrowDownRight className="size-3 mr-1" />}
                            {r.sr_type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">{fmtPrice(Number(r.sr_level))}</td>
                        <td className={`px-3 py-2.5 text-right font-mono font-semibold ${isRes ? "text-bear" : "text-bull"}`}>
                          {Number(r.sr_distance_pct) > 0 ? "+" : ""}{Number(r.sr_distance_pct).toFixed(2)}%
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono">{r.sr_touches}</td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="inline-flex items-center gap-1.5">
                            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${Math.min(Number(r.sr_strength), 100)}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground font-mono w-8 text-right">{Math.round(Number(r.sr_strength))}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <TrendBadge state={r.trend_state} dir={r.trend_direction} score={r.trend_score} />
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{Number(r.adx).toFixed(0)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground hidden md:table-cell">{fmtVol(Number(r.volume_24h))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4 text-center">
          Auto-refreshes every 30s · Cron rescan every 5 min · Showing {filtered.length} symbols on {tf}
        </p>
      </main>
    </div>
  );
}

function TrendBadge({ state, dir, score }: { state: string; dir: string; score: number }) {
  if (state === "ranging") {
    return (
      <Badge variant="outline" className="border-neutral/40 text-neutral gap-1">
        <Minus className="size-3" /> Ranging
      </Badge>
    );
  }
  const up = dir === "up";
  return (
    <Badge variant="outline" className={`gap-1 ${up ? "border-bull/40 text-bull" : "border-bear/40 text-bear"}`}>
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "Trend ↑" : "Trend ↓"} <span className="opacity-60">·{score}/3</span>
    </Badge>
  );
}
