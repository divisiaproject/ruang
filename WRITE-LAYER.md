# Mission Control — Ruang fork with agent write layer

This is a fork of [yugienugraha/ruang](https://github.com/yugienugraha/ruang) (MIT) that adds a
guarded agent write layer on top of the read-only Mission Control.

## What was added

| File | Status | Purpose |
|---|---|---|
| `server/agents-write.ts` | **new** | Guarded `hermes profile` write operations |
| `server/index.ts` | **modified (+4 lines)** | Registers the write module |
| `tests/fixtures/stub-hermes.py` | **new (test only)** | Fake `hermes` for verifying argv handling |

The entire read path (`mission-control.ts`, `privacy.ts`, `folders.ts`, `access.ts`,
`profile-lock.ts`) is **untouched**. All 130 upstream tests still pass.

## Enabling writes

Writes are **off by default**. A server started with no token registers no write routes at all
(`POST /api/agents` returns 404).

```bash
export RUANG_WRITE_TOKEN="$(openssl rand -hex 32)"
ruang --port 3002
```

Optional overrides:

| Variable | Default | Purpose |
|---|---|---|
| `RUANG_WRITE_TOKEN` | *(unset)* | Enables the write layer. Unset = disabled. |
| `RUANG_HERMES_BIN` | `hermes` | Path to the Hermes CLI |
| `RUANG_BACKUP_DIR` | `~/.local/share/ruang/writes` | Export archives + `audit.jsonl` |

## API

All writes require `Authorization: Bearer <RUANG_WRITE_TOKEN>`.

| Method | Route | Body | Effect |
|---|---|---|---|
| `GET` | `/api/agents/write-status` | — | `{enabled, protected, audit}` |
| `GET` | `/api/agents/audit` | — | Recent audit entries + backup dir |
| `POST` | `/api/agents` | `{name, description?, cloneFrom?, noSkills?}` | `hermes profile create` |
| `POST` | `/api/agents/:name/config` | `{key, value}` | `hermes -p <name> config set` |
| `POST` | `/api/agents/:name/rename` | `{to}` | `hermes profile rename` |
| `POST` | `/api/agents/:name/export` | — | `hermes profile export` |
| `DELETE` | `/api/agents/:name` | `{confirm: "<name>"}` | export → verify → `profile delete --yes` |

Status codes: `400` invalid input · `401` bad/missing token · `403` protected (`default`) ·
`404` unknown profile · `409` already exists · `422` CLI rejected · `500` failed verification ·
`503` `hermes` not installed.

## Safety properties (all verified by test)

1. **Off by default.** No token → no write routes registered.
2. **argv arrays only.** `execFile` with a list; never a shell string. A description containing
   `; touch /tmp/pwned2 && echo owned` arrived as a *single* argv element and executed nothing.
3. **Name validation.** `^[a-z0-9]{1,32}$` — matches the CLI's "lowercase alphanumeric" rule.
   Note this **rejects hyphens**: use `leadagent`, not `lead-agent`.
4. **`default` is protected.** Cannot be renamed or deleted (`403`). This check runs *before*
   confirmation, so it cannot be bypassed.
5. **Delete is backup-or-abort.** Export runs first; the archive must exist and be non-trivial in
   size. If export fails, the delete never runs and the profile survives. Verified: a forced
   export failure left the profile intact.
6. **Confirmation echo.** `DELETE` requires `confirm` to exactly equal the profile name.
7. **Append-only audit.** Every attempt, successful or not, is written to
   `<backup-dir>/audit.jsonl` with timestamp, action, target and result.

## Verified behaviour

Run against a stub `hermes` (fixture), in a container:

| Case | Expected | Result |
|---|---|---|
| `write-status` no token | disabled | `{enabled:false}` |
| `POST /api/agents` no token | routes absent | `404` |
| wrong token | reject | `401` |
| create `leadagent` | success | `200`, dir on disk |
| argv for create | 5 clean elements | `["profile","create","leadagent","--description","..."]` |
| name `Bad-Name` | reject | `400 INVALID_NAME` |
| name `lead-agent` | reject | `400 INVALID_NAME` |
| shell payload in description | inert | single argv element, `/tmp/pwned2` absent |
| config `model; touch /tmp/pwned3` | reject | `400 INVALID_KEY` |
| delete `default` | protect | `403 PROTECTED` |
| rename `default` | protect | `403 PROTECTED` |
| delete unknown | reject | `404 NOT_FOUND` |
| delete, export fails | **abort** | `500`, profile still present |
| delete, export ok | export→delete | `200`, backup on disk, order confirmed |

## Known limitations

- **Not tested against a real `hermes` binary.** This build environment has no Hermes CLI, so the
  success path was proven with a stub. The argv shape matches the real
  `hermes profile create --help` output captured from Hermes v0.19.0, but the first real create
  should be treated as a verification step.
- **`--output` flag for export is assumed.** The code falls back to a CWD-relative export if the
  flag is rejected. Confirm `hermes profile export --help` on the target machine.
- **Model is not settable at create time** on v0.19.0 — `profile create` has no model/provider
  flag. Use `POST /api/agents/:name/config` with `model.default` afterwards.
- **Single-process in-memory audit cache** (last 200). The durable record is `audit.jsonl`.
- **No UI yet.** The write layer is API-only; the Agents page does not yet render create/edit
  controls. See "next step" below.

## Build and test

```bash
npm install
npm run build
npm test          # 130 upstream tests

node bin/ruang.js --port 3002
```
