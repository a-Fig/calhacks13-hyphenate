# Norn's company configuration

The schema, validator and loader for the one file that tunes Norn to a company. Written 2026-10-24.
Norn is general, so nothing here names a company. A company's file lives with the company (Bowman's
is `bowman/norn-config/bowman.config.ts`) and default-exports an object of type `CompanyConfig`, or
is a `.json` file holding it.

```
cd norn/config
npm test                                                   # the schema, the rules between fields, the loader, the stored form
npm run check                                              # validates Bowman's file and prints a summary
node src/cli.ts <file> --json                              # the { key, value } pairs Norn's set_config takes
```

## At start-up

The worker (`norn/workers/src/config.ts`) loads the file named by `NORN_COMPANY_CONFIG` before it
connects to anything.
- **Malformed, missing, or rejected by the validator.** The worker prints the problems, one per
  line, and exits with code 1. Nothing has been written to the database.
- **Valid.** Once connected, the worker sends the pairs below through `set_config`, but only the
  ones that differ from what the database already holds. Starting again with the same file stores
  nothing.
- **Unset or blank.** The worker warns and keeps the company config already stored (or, if there
  is none, the module's built-in defaults). It does not refuse to start.

| Key | Value |
|---|---|
| `company_config` | the whole validated configuration, defaults filled in, as canonical JSON (sorted keys, no whitespace; `src/stored.ts`) |
| `deep_review_mode` | `reviewDepth.deepReview.mode` |
| `deep_review_limit` | `reviewDepth.deepReview.maxPasses` |

The file is the source of truth for these three keys: a start-up puts them back to the file's
values, including a `deep_review_mode` that someone switched in the web app since.

## What the module checks, and what it leaves to the loader

`set_config` for `company_config` (`norn/module/src/company-config.ts`) refuses a value that is
over 256 KB, is not JSON, is not an object with a whole-number `schemaVersion`, or is not in
canonical form. The canonical-form rule makes "has it changed" a string comparison.

The module does not run the validator: its TypeScript settings and runtime differ from this
package's. The schema and the rules between fields are checked only by the loader, so a caller that
skips the loader can store a config that passes the module and fails the schema. Code that reads
the stored config must not assume it was validated there.

## In the action log

Each change to `company_config` is one `set_config` row. Its summary gives the old and new
fingerprint (`configHash`, FNV-1a 64 bit, 16 hex characters), the sizes, and the top-level sections
that changed, were added or were removed, for example
`company_config: 335a59f8a0cbb143 -> 5a37a22e7cdd4ff5 (23.0 KB -> 23.0 KB); changed: materiality, reviewDepth`.
It never holds the old or the new JSON, which is in the `norn_config` table. The fingerprint is a
label for telling versions apart, not a signature.

Checked on 2026-10-24 against a scratch database: `NORN_DB=<scratch> npm run check:config` from
`norn/` (see `norn/workers/README.md`).
