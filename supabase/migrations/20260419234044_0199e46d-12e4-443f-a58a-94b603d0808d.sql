CREATE TABLE IF NOT EXISTS public.scanner_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  current_price NUMERIC NOT NULL,
  sr_level NUMERIC,
  sr_type TEXT,
  sr_touches INTEGER,
  sr_distance_pct NUMERIC,
  sr_strength NUMERIC,
  trend_state TEXT,
  trend_direction TEXT,
  trend_score INTEGER,
  adx NUMERIC,
  volume_24h NUMERIC,
  heading_toward BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_scanner_results_tf ON public.scanner_results(timeframe);
CREATE INDEX IF NOT EXISTS idx_scanner_results_distance ON public.scanner_results(sr_distance_pct);
CREATE INDEX IF NOT EXISTS idx_scanner_results_updated ON public.scanner_results(updated_at DESC);

ALTER TABLE public.scanner_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scanner results are publicly readable"
  ON public.scanner_results FOR SELECT
  USING (true);

CREATE TABLE IF NOT EXISTS public.scanner_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  symbols_scanned INTEGER,
  status TEXT,
  error TEXT
);

ALTER TABLE public.scanner_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scanner runs are publicly readable"
  ON public.scanner_runs FOR SELECT
  USING (true);