-- Do people come back? Per first-visit day: visitors, and how many came back the next day and within 7 days.
WITH first AS (SELECT vid, min(day) AS d0 FROM visits GROUP BY vid),
days AS (SELECT DISTINCT vid, day FROM visits)
SELECT f.d0 AS first_day, count(DISTINCT f.vid) AS visitors,
  count(DISTINCT f.vid) FILTER (WHERE d.day = f.d0 + 1) AS back_next_day,
  count(DISTINCT f.vid) FILTER (WHERE d.day > f.d0 AND d.day <= f.d0 + 7) AS back_within_7d,
  round(100.0 * count(DISTINCT f.vid) FILTER (WHERE d.day > f.d0 AND d.day <= f.d0 + 7) / count(DISTINCT f.vid), 1) AS back_7d_pct
FROM first f LEFT JOIN days d USING (vid)
GROUP BY f.d0 ORDER BY f.d0 DESC;
