# Product pillar schema-reset recovery

## Recall

- User request: repair the newly built OpenCorvus package that again showed `managed backend did not become healthy within 30 seconds: managed backend has no active process`; preserve the historical database and export then import its data into the database required by the new package.
- Acceptance: preserve the original SQLite database, WAL (Write-Ahead Log) and SHM (Shared Memory) files; recover every portable business row into the package's exact current DDL (Data Definition Language); retain auditable evidence for the new required field; pass SQLite integrity and foreign-key checks; and prove the actual 0.0.32-beta Overlay and managed backend become healthy against the recovered formal database.
- Hard constraints: no runtime migration, compatibility reader, same-name implicit copy, fallback schema, startup reset, or modification of the original database. Recovery is an explicit maintenance operation authorized by the user. Unrelated dirty workspace changes must remain untouched.
- Read records and architecture: `specs/records/2026-08/2026-08-05-large-mysql-transfer-statement-closure.md`, `specs/records/2026-08/2026-08-05-composer-product-and-conversation-selects-plan.md`, `specs/current/architecture/17-code-work-agent-platform.md`, and repository `AGENTS.md` database rule 18.
- Repository searches: `SCHEMA_DDL`, `EngineTaskTable`, MySQL (My Structured Query Language) transfer schema and snapshot validation, `product_pillar`, Composer intent mapping, Mission caller experience, database rebuild ownership, and global runtime paths.
- Independent agent feedback: none; the user did not request sub-agents or parallel audit.

## Causal chain

1. The Overlay's 30-second message was only the observable wrapper failure.
2. The exact backend log `C:\Users\10132\AppData\Local\opencorvus\log\2026-08-06T054608-8304-1.log` reported typed `SCHEMA_RESET_REQUIRED` because `table:engine_task` differed from the package DDL.
3. Directly probing the packaged sidecar in an isolated runtime proved that 0.0.32-beta requires `engine_task.product_pillar text NOT NULL` between `source` and `title`, and its Mission projection requires `session.metadata.mission.productPillar`.
4. The formal historical database was structurally sound but predated both required product-pillar values. Strict schema validation therefore correctly refused to open it; after the first Task-column-only recovery, `/work-ledger` exposed the remaining Mission metadata gap as a typed projection error instead of silently choosing a default.
5. This is an intentional schema breakpoint from the Code/Work product-pillar implementation, not a repeat of the earlier large-transfer statement-finalization defect and not SQLite corruption.

## Explicit recovery

- The exact pre-recovery database trio was copied to `%LOCALAPPDATA%\opencorvus\data\maintenance-backups\schema-reset-product-pillar-20260806-135816` before the formal Overlay process was stopped.
- The original database SHA-256 (Secure Hash Algorithm 256-bit) digest is `71E7C9486EAF1BDB3518D386C25FB0DF881C10A13E9AB79D1D3B8B986B406260`.
- The unchanged WAL digest is `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`; the unchanged SHM digest is `FD4C9FDA9CD3F9AE7C962B0DDF37232294D55580E1AA165AA06129B8549389EB`.
- A current-schema portable transfer package was generated at `mysql-transfer-current-schema.json`: 40 tables, 35,122 rows, 120,780,237 bytes, SHA-256 `9E1E4E455A552D390AAEA44C94E5071FA8B8D95CB71911930084F370934D7508`.
- All 34 historical Task rows recovered `product_pillar=code`. Thirty-three use the exact persisted `conversation.experience` or `mission.caller.experience` evidence. The one older Mission without caller experience uses its original request's explicit `Coding` classification; the audit records Task ID, Mission session ID, and request digest.
- All three Mission sessions recovered `metadata.mission.productPillar=code`: one from persisted caller experience, one from its owning Task's original explicit `Coding` request, and one Task-less Mission from the exact persisted original user message part that explicitly says `Coding`. No title, directory, source, profile, or product default was used.
- Per-Task mapping evidence, import results, row counts, current DDL, and validation output are stored in `product-pillar-recovery-audit.json` beside the backup.
- The isolated import was built from the current complete DDL, never by modifying or opening the old database through the application.

## Verification

| Check | Result |
| --- | --- |
| Portable tables and rows | 40 tables, 35,122 rows |
| Projects | 145 |
| Tasks | 34 |
| Sessions | 244 |
| Messages | 4,726 |
| Parts | 26,035 |
| Engine artifacts | 520 |
| Product pillars | 34 `code` |
| Mission product pillars | 3 `code` |
| SQLite integrity | `ok` |
| Foreign-key violations | 0 |
| Isolated packaged-sidecar start | healthy; `/work-ledger` returned HTTP 200 on port 17880 |
| Formal 0.0.32-beta Overlay | process 2392 launched managed sidecar process 9968 |
| Formal backend health | `healthy: true` on `http://127.0.0.1:7878/global/health` |
| Formal Work Ledger | HTTP 200 with Task and Mission projections |
| Formal database path | `C:\Users\10132\AppData\Local\opencorvus\data\opencorvus.db` |

The final formal recovered database digest before its successful package launch was `73283570E28EF41316002DA6EA71C8C47BE5690800722FD5DB201F6306EB0966`. The application remains open after successful verification.
