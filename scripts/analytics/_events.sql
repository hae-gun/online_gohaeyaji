-- Shared view: every event file in ./track (today's .jsonl and gzipped older days), times in Korean time.
-- Run any query with:  duckdb -c ".read _events.sql" -c ".read funnel.sql"   (from this folder, files in ./track)
CREATE OR REPLACE VIEW events AS
SELECT
  to_timestamp(ts / 1000) AT TIME ZONE 'Asia/Seoul' AS at_kst,
  CAST(to_timestamp(ts / 1000) AT TIME ZONE 'Asia/Seoul' AS DATE) AS day,
  vid, sid, type, p
FROM read_json('track/*.jsonl*', format = 'newline_delimited',
               columns = {ts: 'BIGINT', vid: 'VARCHAR', sid: 'VARCHAR', type: 'VARCHAR', p: 'JSON'});

-- one row per visit (sid): when it started, how long it lasted, how far it got
CREATE OR REPLACE VIEW visits AS
SELECT
  sid, any_value(vid) AS vid, min(at_kst) AS started, min(day) AS day,
  greatest(epoch(max(at_kst) - min(at_kst)), max(CAST(p->>'sec' AS INTEGER)) FILTER (WHERE type = 'session_end')) AS seconds,
  any_value(p->>'src') FILTER (WHERE type = 'session_start') AS src,
  any_value(p->>'dev') FILTER (WHERE type = 'session_start') AS dev,
  bool_or(type = 'enter_hall') AS entered,
  bool_or(type = 'first_move') AS moved,
  bool_or(type = 'booth_enter') AS booth,
  bool_or(type = 'confess_submit') AS confessed,
  bool_or(type = 'answer_done') AS heard,
  bool_or(type = 'card_share') AS card,
  bool_or(type = 'travel') AS travelled
FROM events GROUP BY sid;
