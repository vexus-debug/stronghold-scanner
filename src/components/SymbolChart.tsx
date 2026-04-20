import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SRZone } from "@/lib/ta";

type Candle = { time: number; open: number; high: number; low: number; close: number };

type Props = {
  candles: Candle[];
  zones: (SRZone & { distancePct: number })[];
  heading: (SRZone & { distancePct: number }) | null;
  height?: number;
};

// Read CSS variable as oklch and pass through — lightweight-charts accepts any valid CSS color.
function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `oklch(${v})` : fallback;
}

export function SymbolChart({ candles, zones, heading, height = 380 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const fg = cssVar("--foreground", "#e5e7eb");
    const muted = cssVar("--muted-foreground", "#9ca3af");
    const border = cssVar("--border", "#27272a");
    const bull = cssVar("--bull", "#22c55e");
    const bear = cssVar("--bear", "#ef4444");

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
      },
      grid: {
        vertLines: { color: border, style: LineStyle.Dotted },
        horzLines: { color: border, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    });

    const series = chart.addCandlestickSeries({
      upColor: bull,
      downColor: bear,
      borderUpColor: bull,
      borderDownColor: bear,
      wickUpColor: bull,
      wickDownColor: bear,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // height is intentionally not a dep — chart autoSizes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data + S/R lines whenever inputs change
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || candles.length === 0) return;

    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    // Clear previous price lines, then add fresh ones
    // (lightweight-charts has no clearPriceLines, so we track them)
    const lines = (series as unknown as { _srLines?: ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[] })._srLines ?? [];
    for (const l of lines) series.removePriceLine(l);
    const fresh: ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[] = [];

    const bull = cssVar("--bull", "#22c55e");
    const bear = cssVar("--bear", "#ef4444");
    const primary = cssVar("--primary", "#f59e0b");

    // Show top 6 strongest zones to avoid clutter
    const top = [...zones].sort((a, b) => b.strength - a.strength).slice(0, 6);
    for (const z of top) {
      const isHeading = heading && Math.abs(z.level - heading.level) < z.level * 1e-6;
      const color = isHeading ? primary : z.type === "resistance" ? bear : bull;
      const line = series.createPriceLine({
        price: z.level,
        color,
        lineWidth: isHeading ? 2 : 1,
        lineStyle: isHeading ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${z.type[0].toUpperCase()} ${Math.round(z.strength)}`,
      });
      fresh.push(line);
    }
    (series as unknown as { _srLines?: typeof fresh })._srLines = fresh;

    chart.timeScale().fitContent();
  }, [candles, zones, heading]);

  return <div ref={containerRef} style={{ height, width: "100%" }} />;
}