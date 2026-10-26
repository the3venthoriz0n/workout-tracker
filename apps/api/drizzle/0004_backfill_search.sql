-- Fill the search columns of versions published before they existed (same rules as the service:
-- NFKC, whitespace collapsed, lowercase; the latest title/description of the listing).
UPDATE "shared_plan_version" AS v SET
  "day_count" = jsonb_array_length(v."snapshot"->'days'),
  "no_gear" = NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v."snapshot"->'days') AS d(day)
    CROSS JOIN jsonb_array_elements(d.day->'items') AS i(item)
    WHERE jsonb_array_length(i.item->'gear') > 0
  ),
  "search_text" = lower(trim(regexp_replace(normalize(
    sp."title" || ' ' || sp."description" || ' ' || coalesce((
      SELECT string_agg(i.item->>'exercise', ' ')
      FROM jsonb_array_elements(v."snapshot"->'days') AS d(day)
      CROSS JOIN jsonb_array_elements(d.day->'items') AS i(item)
    ), ''), NFKC), '\s+', ' ', 'g')))
FROM "shared_plan" AS sp
WHERE sp."id" = v."shared_plan_id" AND v."day_count" = 0;
