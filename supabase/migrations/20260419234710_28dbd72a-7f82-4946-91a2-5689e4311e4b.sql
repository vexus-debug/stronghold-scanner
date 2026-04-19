CREATE POLICY "Anyone can insert scanner results"
  ON public.scanner_results FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update scanner results"
  ON public.scanner_results FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can insert scanner runs"
  ON public.scanner_runs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update scanner runs"
  ON public.scanner_runs FOR UPDATE
  USING (true) WITH CHECK (true);