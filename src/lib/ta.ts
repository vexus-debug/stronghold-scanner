// Technical analysis helpers: pivots, S/R clustering, ADX, EMA, BB, HH/HL.

export type Kline = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : NaN);
  }
  return out;
}

export function stddev(values: number[], period: number): number[] {
  const means = sma(values, period);
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    const m = means[i];
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - m) ** 2;
    out.push(Math.sqrt(s / period));
  }
  return out;
}

// Average Directional Index (Wilder)
export function adx(klines: Kline[], period = 14): number {
  if (klines.length < period * 2) return 0;
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const cur = klines[i];
    const prev = klines[i - 1];
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      )
    );
  }
  const wilder = (arr: number[]) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };
  const trS = wilder(tr);
  const pS = wilder(plusDM);
  const mS = wilder(minusDM);
  const dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const pDI = (100 * pS[i]) / trS[i];
    const mDI = (100 * mS[i]) / trS[i];
    const sum = pDI + mDI;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(pDI - mDI)) / sum);
  }
  if (dx.length < period) return dx[dx.length - 1] || 0;
  // Average last `period` DX values
  const last = dx.slice(-period);
  return last.reduce((a, b) => a + b, 0) / last.length;
}

// Find swing pivots (local highs/lows) with given lookback.
export function findPivots(klines: Kline[], lookback = 3) {
  const highs: { idx: number; price: number }[] = [];
  const lows: { idx: number; price: number }[] = [];
  for (let i = lookback; i < klines.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (klines[j].high >= klines[i].high) isHigh = false;
      if (klines[j].low <= klines[i].low) isLow = false;
    }
    if (isHigh) highs.push({ idx: i, price: klines[i].high });
    if (isLow) lows.push({ idx: i, price: klines[i].low });
  }
  return { highs, lows };
}

export type SRZone = {
  level: number;
  touches: number;
  type: "support" | "resistance";
  volumeScore: number; // 0..1 — fraction of total volume traded near this zone
  strength: number; // composite 0..100
};

// Cluster pivots into zones using a price tolerance, then score by touches + volume.
export function findSRZones(
  klines: Kline[],
  currentPrice: number,
  opts: { tolerancePct?: number; minTouches?: number; lookback?: number } = {}
): SRZone[] {
  const tolerancePct = opts.tolerancePct ?? 0.004; // 0.4%
  const minTouches = opts.minTouches ?? 5;
  const lookback = opts.lookback ?? 3;

  const { highs, lows } = findPivots(klines, lookback);
  const all = [
    ...highs.map((h) => ({ ...h, kind: "high" as const })),
    ...lows.map((l) => ({ ...l, kind: "low" as const })),
  ];

  // Sort pivots by price for stable agglomerative clustering (avoids order bias).
  all.sort((a, b) => a.price - b.price);
  const clusters: { prices: number[]; idxs: number[]; mean: number }[] = [];
  for (const p of all) {
    const tol = p.price * tolerancePct;
    // Find best (closest) existing cluster within tolerance, not just the first match.
    let best: (typeof clusters)[number] | null = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const d = Math.abs(c.mean - p.price);
      if (d <= tol && d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    if (best) {
      best.prices.push(p.price);
      best.idxs.push(p.idx);
      best.mean = best.prices.reduce((a, b) => a + b, 0) / best.prices.length;
    } else {
      clusters.push({ prices: [p.price], idxs: [p.idx], mean: p.price });
    }
  }

  // Volume profile: total volume in price range
  const totalVolume = klines.reduce((a, k) => a + k.volume, 0) || 1;
  const lastIdx = klines.length - 1;

  const zones: SRZone[] = [];
  for (const c of clusters) {
    if (c.prices.length < minTouches) continue;
    const level = c.mean;
    const tol = level * tolerancePct * 1.5;
    // Volume traded while price was within zone
    let zoneVol = 0;
    for (const k of klines) {
      if (k.low <= level + tol && k.high >= level - tol) zoneVol += k.volume;
    }
    const volumeScore = zoneVol / totalVolume;
    const type = level >= currentPrice ? "resistance" : "support";

    // Recency: weight zones with recent touches higher (decay over lookback window).
    const maxIdx = Math.max(...c.idxs);
    const recency = Math.max(0, 1 - (lastIdx - maxIdx) / klines.length); // 0..1

    // Spread: tight clusters (low std dev relative to level) are more reliable.
    const mean = level;
    const variance =
      c.prices.reduce((a, p) => a + (p - mean) ** 2, 0) / c.prices.length;
    const spreadPct = Math.sqrt(variance) / mean;
    const tightness = Math.max(0, 1 - spreadPct / tolerancePct); // 0..1

    // Composite strength
    const touchScore = Math.min(c.prices.length / 10, 1) * 45;
    const volScore = Math.min(volumeScore * 5, 1) * 30;
    const recencyScore = recency * 15;
    const tightScore = tightness * 10;

    zones.push({
      level,
      touches: c.prices.length,
      type,
      volumeScore,
      strength: touchScore + volScore + recencyScore + tightScore,
    });
  }
  return zones.sort((a, b) => b.strength - a.strength);
}

// Pick the closest strong S/R the price is heading toward based on short-term momentum.
// Uses the slope of the last N closes (not just one candle's color) for a more robust signal.
export function nearestHeadingZone(
  zones: SRZone[],
  currentPrice: number,
  dir: "up" | "down"
): SRZone | null {
  const filtered = zones.filter((z) =>
    dir === "up" ? z.level > currentPrice : z.level < currentPrice
  );
  if (filtered.length === 0) return null;
  // Rank by closeness, but prefer stronger zones when distances are similar.
  filtered.sort((a, b) => {
    const da = Math.abs(a.level - currentPrice) / currentPrice;
    const db = Math.abs(b.level - currentPrice) / currentPrice;
    // Composite: distance penalty + strength bonus
    const scoreA = da * 100 - a.strength * 0.05;
    const scoreB = db * 100 - b.strength * 0.05;
    return scoreA - scoreB;
  });
  return filtered[0];
}

// Short-term momentum direction from the last N closes using EMA slope.
export function shortTermDirection(klines: Kline[], window = 5): "up" | "down" {
  if (klines.length < window + 1) {
    const last = klines[klines.length - 1];
    return last.close >= last.open ? "up" : "down";
  }
  const closes = klines.slice(-window - 1).map((k) => k.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  return last >= first ? "up" : "down";
}

// Trend detection: combines ADX, EMA slope, BB width, HH/HL structure.
export function detectTrend(klines: Kline[]): {
  state: "trending" | "ranging";
  direction: "up" | "down" | "neutral";
  score: number; // 0-3 agreement
  adxValue: number;
} {
  const closes = klines.map((k) => k.close);
  const adxVal = adx(klines, 14);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const last = closes.length - 1;

  // Signal 1: ADX
  const adxTrending = adxVal > 25;

  // Signal 2: EMA slope
  const emaUp = ema20[last] > ema20[last - 5] && ema20[last] > ema50[last];
  const emaDown = ema20[last] < ema20[last - 5] && ema20[last] < ema50[last];

  // Signal 3: HH/HL structure (last 20 candles)
  const recent = klines.slice(-30);
  const { highs, lows } = findPivots(recent, 2);
  let hhhl = false;
  let lhll = false;
  if (highs.length >= 2 && lows.length >= 2) {
    const lastH = highs[highs.length - 1].price;
    const prevH = highs[highs.length - 2].price;
    const lastL = lows[lows.length - 1].price;
    const prevL = lows[lows.length - 2].price;
    hhhl = lastH > prevH && lastL > prevL;
    lhll = lastH < prevH && lastL < prevL;
  }

  // Signal 4 (BB width): expanding = trending
  const sd = stddev(closes, 20);
  const bbWidthNow = sd[last] / closes[last];
  const bbWidthPast = sd[last - 10] / closes[last - 10];
  const bbExpanding = bbWidthNow > bbWidthPast * 1.05;

  let upScore = 0;
  let downScore = 0;
  if (adxTrending && emaUp) upScore++;
  if (adxTrending && emaDown) downScore++;
  if (hhhl) upScore++;
  if (lhll) downScore++;
  if (bbExpanding && emaUp) upScore++;
  if (bbExpanding && emaDown) downScore++;

  const score = Math.max(upScore, downScore);
  if (score === 0 || adxVal < 20) {
    return { state: "ranging", direction: "neutral", score: 0, adxValue: adxVal };
  }
  return {
    state: "trending",
    direction: upScore > downScore ? "up" : "down",
    score,
    adxValue: adxVal,
  };
}