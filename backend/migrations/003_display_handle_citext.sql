DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'display_handle'
      AND udt_name <> 'citext'
  ) THEN
    ALTER TABLE users
      ALTER COLUMN display_handle TYPE CITEXT
      USING display_handle::citext;
  END IF;
END $$;
