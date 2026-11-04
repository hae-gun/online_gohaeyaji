-- Where people drop off, per day: visits that reached each step, and the share of the first step.
SELECT day,
  count(*) AS visits,
  count(*) FILTER (WHERE entered) AS entered,
  count(*) FILTER (WHERE moved) AS moved,
  count(*) FILTER (WHERE booth) AS booth,
  count(*) FILTER (WHERE confessed) AS confessed,
  count(*) FILTER (WHERE heard) AS heard,
  count(*) FILTER (WHERE card) AS card,
  round(100.0 * count(*) FILTER (WHERE booth) / count(*), 1) AS booth_pct,
  round(100.0 * count(*) FILTER (WHERE confessed) / nullif(count(*) FILTER (WHERE booth), 0), 1) AS confess_of_booth_pct
FROM visits GROUP BY day ORDER BY day DESC;
