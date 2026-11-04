-- Where people come from and how each source does: visits, median length, booth and confession rates.
SELECT src, dev, count(*) AS visits,
  round(quantile_cont(seconds, 0.5)) AS median_sec,
  round(100.0 * count(*) FILTER (WHERE booth) / count(*), 1) AS booth_pct,
  round(100.0 * count(*) FILTER (WHERE confessed) / count(*), 1) AS confessed_pct
FROM visits GROUP BY src, dev ORDER BY visits DESC;

-- by hour of day (Korean time)
SELECT hour(started) AS hour, count(*) AS visits FROM visits GROUP BY hour ORDER BY hour;
