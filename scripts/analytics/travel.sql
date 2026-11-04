-- Did 이동하기 help? Visits that used it versus those that did not.
SELECT travelled, count(*) AS visits,
  round(quantile_cont(seconds, 0.5)) AS median_sec,
  round(100.0 * count(*) FILTER (WHERE booth) / count(*), 1) AS booth_pct,
  round(100.0 * count(*) FILTER (WHERE confessed) / count(*), 1) AS confessed_pct
FROM visits WHERE entered GROUP BY travelled;

SELECT p->>'to' AS destination, count(*) AS n FROM events WHERE type = 'travel' GROUP BY destination ORDER BY n DESC;
