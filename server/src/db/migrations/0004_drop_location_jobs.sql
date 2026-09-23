--> A location travels with its fields flat beside its text (ADR #31), and so
--> does its draft in a generator job. A stored job whose payload still holds a
--> location in the earlier `properties` shape is deleted, not converted
--> (ADR #28, rule 2; decided in ADR #31): an augment run on a location, and a
--> scene run whose result carries a location stub. No other row is touched.
DELETE FROM `generate_jobs`
WHERE `target_path` LIKE 'locations/%'
   OR CASE
        WHEN json_valid(`result`) THEN EXISTS (
          SELECT 1 FROM json_each(`result`, '$.stubs')
          WHERE json_extract(`value`, '$.kind') = 'location'
        )
        ELSE 0
      END;
