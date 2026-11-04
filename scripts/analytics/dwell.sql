-- How long visits last (median and top 10%), per day and device, and seconds spent in each place.
SELECT day, dev, count(*) AS visits,
  round(quantile_cont(seconds, 0.5)) AS median_sec,
  round(quantile_cont(seconds, 0.9)) AS p90_sec
FROM visits GROUP BY day, dev ORDER BY day DESC, visits DESC;

-- time in each place: from one place_enter to the next event that changes place (or the visit's end)
WITH moves AS (
  SELECT sid, at_kst, p->>'place' AS place,
         lead(at_kst) OVER (PARTITION BY sid ORDER BY at_kst) AS next_at
  FROM events WHERE type = 'place_enter'
)
SELECT place, count(*) AS entries,
  round(quantile_cont(epoch(next_at - at_kst), 0.5)) AS median_sec
FROM moves WHERE next_at IS NOT NULL
GROUP BY place ORDER BY entries DESC;
