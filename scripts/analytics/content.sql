-- What people confess and what they react to.
-- categories: confessions, heard to the end, cards made (share of confessions)
SELECT p->>'cat' AS category,
  count(*) FILTER (WHERE type = 'confess_submit') AS confessed,
  count(*) FILTER (WHERE type = 'answer_done') AS heard,
  count(*) FILTER (WHERE type = 'card_share') AS cards,
  round(100.0 * count(*) FILTER (WHERE type = 'card_share') / nullif(count(*) FILTER (WHERE type = 'confess_submit'), 0), 1) AS card_pct
FROM events WHERE type IN ('confess_submit', 'answer_done', 'card_share') AND coalesce(p->>'cat', '') <> ''
GROUP BY category ORDER BY confessed DESC LIMIT 40;

-- answers by kind (answer, chat, safety, blocked, tooShort) and how many were cautious
SELECT p->>'kind' AS kind, count(*) AS n, count(*) FILTER (WHERE p->>'caution' = '1') AS cautious
FROM events WHERE type = 'confess_submit' GROUP BY kind ORDER BY n DESC;

-- priests: cards made per answer heard
SELECT p->>'persona' AS priest,
  count(*) FILTER (WHERE type = 'answer_done') AS heard,
  count(*) FILTER (WHERE type = 'card_share') AS cards
FROM events WHERE type IN ('answer_done', 'card_share') GROUP BY priest ORDER BY heard DESC;

-- verdict stamps: how far people got with each (answers heard, cards made)
SELECT p->>'grade' AS grade,
  count(*) FILTER (WHERE type = 'answer_done') AS heard,
  count(*) FILTER (WHERE type = 'card_share') AS cards,
  count(*) FILTER (WHERE type = 'history_card') AS reopened
FROM events WHERE type IN ('answer_done', 'card_share', 'history_card') AND coalesce(p->>'grade', '') <> ''
GROUP BY grade ORDER BY heard DESC;

-- emotes and other things done in the cathedral
SELECT CASE WHEN type = 'emote' THEN 'emote:' || (p->>'id') ELSE type END AS what, count(*) AS n, count(DISTINCT sid) AS visits
FROM events WHERE type IN ('emote', 'sit', 'candle', 'offering', 'font', 'pigeon', 'travel', 'face_saved', 'face_import', 'look_change', 'inquiry', 'history_open', 'history_card')
GROUP BY what ORDER BY n DESC;
