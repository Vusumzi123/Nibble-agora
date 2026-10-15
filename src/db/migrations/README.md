# Migrations

Applied in filename order by `src/db/migrate.ts`, each in its own transaction,
recorded in the `schema_migrations` table.

- Name files `NNNN_snake_case.sql` (four digits, underscores). Anything else —
  including `3-foo.sql` or `README.md` — is ignored.
- **Never edit `../schema.sql`** once it has been applied anywhere. It is the
  idempotent baseline, recorded as the marker row `0000_schema_baseline`.
  Schema changes after that point are new files here.
- Migrations run inside a transaction: no `BEGIN`/`COMMIT` in the file, and
  no `PRAGMA foreign_keys` (it is a no-op inside a transaction; the connection
  already sets it).

Example `0001_add_cards_label.sql`:

```sql
ALTER TABLE cards ADD COLUMN label TEXT;
```
