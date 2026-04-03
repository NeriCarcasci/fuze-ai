# Phase 1: Compliance MVP — Implementation Prompts

Each prompt below is self-contained and can be handed to Claude Code (or any AI coding assistant) to implement the subphase. Prompts reference actual file paths in the monorepo ecosystem:

| Repo | Path | Description |
|------|------|-------------|
| SDK (TypeScript) | `D:/fuze/packages/core/` | Open-source Fuze SDK |
| SDK (Python) | `D:/fuze-python/src/fuze_ai/` | Python port of the SDK |
| Cloud Dashboard | `D:/fuze-dashboard/cloud-dashboard/` | React + Vite SPA |
| Cloud API | `D:/fuze-dashboard/cloud-api/` | Express backend on Cloud Run |
| Marketing Website | `D:/fuze-web/` | Next.js site at fuze-ai.tech |
| Medicore Demo | `D:/medicore/` | Integration test agent |

---

## Prompt 1.1: Critical Bug Fixes (SDK Stability)

### Context

The Fuze SDK is a TypeScript library at `D:/fuze/packages/core/`. Its core function `guard()` wraps any sync/async function with runtime safety: loop detection, budget enforcement, timeout, side-effect tracking, and JSONL audit tracing.

Key files you will modify:
- `packages/core/src/guard.ts` — the guard wrapper (287 lines). The timeout is implemented via `Promise.race()` at lines 145-155. The `clearTimeout` is called in `fn.apply(this, args).finally(() => clearTimeout(timer))`, but if the guard exits early (budget block at line 126, loop detection at lines 61-104, service kill at line 137), the timer is never started so there's no leak in THOSE paths. The actual leak is: if the timeout timer fires and rejects, the original function's promise keeps running. The timer IS cleaned up on normal completion, but the function is NOT cancelled on timeout — it becomes a dangling promise.
- `packages/core/src/side-effect-registry.ts` — compensation handler. The `rollback()` method calls compensation functions. Check that `compensationEndedAt` timestamps are captured AFTER the handler resolves, not before.
- `packages/core/src/errors.ts` — error classes.
- `packages/core/src/types.ts` — type definitions.

Existing tests: `packages/core/test/` — 8 test files, ~199 tests total using vitest.

The Python SDK at `D:/fuze-python/` has identical architecture but in Python. After fixing TS bugs, check if the same bugs exist in the Python code.

### Task

**Objective 1.1.1: Fix guard() Timer Leak**

In `guard.ts` lines 144-155, when a timeout fires:
1. The `GuardTimeout` error is thrown via `Promise.race`
2. But `fn.apply(this, args)` keeps running as a dangling promise
3. Its `.finally()` calls `clearTimeout(timer)` — but the timer already fired, so this is a no-op
4. The dangling function promise is never awaited or cancelled

This is a memory/resource leak in long-running processes. Fix it by:
- Using an `AbortController` or a cancellation flag that the wrapped function can check
- OR: at minimum, ensure the dangling promise's result is ignored and its rejection is caught (to prevent unhandled rejection warnings)
- Ensure `clearTimeout` is called in ALL exit paths: normal completion, error throw, budget block, loop detection kill, service kill, and timeout

Write these tests in `packages/core/test/guard.test.ts`:

1. **Timer cleanup on normal completion**: Create a guard with 5000ms timeout. Call the guarded function which completes in 10ms. Assert `clearTimeout` was called (spy on global `clearTimeout`). Assert no pending timers via `vi.getTimerCount()` after using `vi.useFakeTimers()`.

2. **Timer fires correctly**: Create a guard with 100ms timeout on a function that takes 500ms. Assert `GuardTimeout` is thrown with `timeoutMs === 100`. Assert the error message contains the function name.

3. **No timer leak under load**: Run 1000 guard() calls sequentially, each with a 1s timeout but completing in 1ms. After all complete, assert `process._getActiveHandles().filter(h => h instanceof Timeout).length === 0` (no leaked timers). Use `vi.useFakeTimers()` if needed.

**Objective 1.1.2: Fix compensationEndedAt Timestamp**

In `side-effect-registry.ts`, the `rollback()` method calls compensation functions. Find where `compensationEndedAt` or equivalent timestamp is captured. Ensure it's captured AFTER `await compensateFn(result)` resolves (or rejects), not before.

Write these tests in `packages/core/test/side-effect-registry.test.ts`:

1. **Timestamp after completion**: Register a compensation function that takes 200ms (use `await new Promise(r => setTimeout(r, 200))`). Call rollback. Assert `endedAt - startedAt >= 200`.

2. **Timestamp on error**: Register a compensation function that throws after 100ms. Call rollback. Assert `endedAt` is still captured (in finally block) AND the error is recorded in the result.

**Objective 1.1.3 & 1.1.4: High and Medium Severity Issues**

Review ALL source files in `packages/core/src/` for these categories of issues:

High severity (fix first):
- Unhandled promise rejections (fire-and-forget `void` calls that could reject)
- Race conditions in concurrent guard() calls sharing the same run context
- Missing error handling in service communication (api-service.ts, daemon-service.ts)
- Incorrect cost calculation edge cases (division by zero, NaN propagation)
- Hash chain integrity gaps (missing entries, out-of-order writes)
- Configuration merge bugs (deep merge vs shallow merge of nested objects)
- Type safety gaps (any casts, missing null checks)

Medium severity (fix after high):
- Inconsistent error messages across error classes
- Missing input validation on public API functions
- Suboptimal batching in api-service.ts (events can be lost on process exit)
- TraceRecorder buffer not flushed on uncaught exceptions
- LoopDetector window not cleared between runs when using `guard()` (not `createRun()`)
- Pricing data staleness (no mechanism to update provider-pricing.json)
- Config loader silently ignores malformed fuze.toml fields
- SideEffectRegistry compensation order not guaranteed under concurrent execution

For each issue found, write at least 1 regression test. Document what you fixed in git commit messages.

### Acceptance Criteria

- All existing ~199 tests pass with zero regressions
- At minimum 12 new tests added (3 + 2 + 7 + 8, some issues may need more)
- `npx vitest run` in `packages/core/` passes
- Check Python SDK at `D:/fuze-python/` for the same bugs. If found, fix them too and run `cd /d/fuze-python && python -m pytest`.
- No `any` casts introduced in fixes

---

## Prompt 1.2: FuzeService Refactor

### Context

The Fuze SDK at `D:/fuze/packages/core/` currently has two transport/service layers:

1. **Old (deprecated):** `src/transports/` — `TelemetryTransport` interface with `NoopTransport`, `SocketTransport`, `CloudTransport`. These are one-directional (SDK → cloud only).

2. **New:** `src/services/` — `FuzeService` interface (`src/services/types.ts`) with `NoopService`, `DaemonService`, `ApiService`. These are bidirectional (SDK ↔ cloud).

The old `TelemetryTransport` is still exported from `src/index.ts` with a `@deprecated` tag. The new `FuzeService` is already the active system — `guard.ts` and `index.ts` use `createService()` which returns a `FuzeService`.

The `ApiService` (`src/services/api-service.ts`) already implements batched telemetry and config fetching, but needs hardening:
- Batching: buffers events, flushes every 1s, max 10,000 buffer
- Config refresh: every 30s
- Step check timeout: 50ms fallback to 'proceed'

The Python SDK at `D:/fuze-python/` has `daemon_client.py` but NO equivalent of `FuzeService` / `ApiService`. It only has local file-based tracing.

### Task

**Objective 1.2.1: Remove TelemetryTransport**

1. Delete all files in `packages/core/src/transports/` (noop.ts, socket.ts, cloud.ts, types.ts, index.ts)
2. Remove all `TelemetryTransport` exports from `packages/core/src/index.ts` (lines 36-39)
3. Search for any remaining references to `TelemetryTransport`, `createTransport`, `NoopTransport`, `SocketTransport`, `CloudTransport` across the entire `D:/fuze/` repo and remove them
4. Update `packages/core/package.json` exports if the transports directory was listed
5. Run tests to ensure nothing breaks

Write these tests:
1. `import { FuzeService } from 'fuze-ai'` works (type import)
2. `import { createService, ApiService, DaemonService, NoopService } from 'fuze-ai'` works
3. Attempting to import old names (`TelemetryTransport`, `createTransport`) fails at the TypeScript level (this is a compile-time check, not a runtime test)

**Objective 1.2.2: Harden ApiService**

The `ApiService` at `src/services/api-service.ts` needs these improvements:

1. **Circuit breaker**: After 3 consecutive failed HTTP requests, stop attempting for 60 seconds. After 60s, try one probe request. If it succeeds, resume normal operation. If it fails, reset the 60s timer.

2. **Graceful shutdown**: Add a `flush()` method that sends all buffered events immediately. Call it from `disconnect()`. Ensure no data loss on `process.exit` by registering a `beforeExit` handler.

3. **Configurable flush interval**: Currently hardcoded at 1s. Make it configurable via `FuzeConfig.cloud.flushIntervalMs` (default: 5000, min: 1000).

4. **Retry with backoff**: Failed telemetry batches are re-enqueued. Add exponential backoff: 1s, 2s, 4s, 8s, max 30s.

5. **Telemetry overhead measurement**: The `sendStepStart` call has a 50ms timeout. Verify this doesn't slow down guard() by more than 5ms in the common case (service responds quickly or is unreachable).

Write these tests in a new file `packages/core/test/api-service.test.ts`:

1. **Batching**: Enqueue 10 events via `sendStepEnd`. Advance fake timers by flush interval. Assert exactly 1 HTTP POST with 10 events in the body.

2. **Circuit breaker opens**: Mock HTTP to fail 3 times. Assert 4th call is NOT attempted. Assert `isConnected()` returns false.

3. **Circuit breaker recovery**: After circuit opens, advance timers by 60s. Assert probe request is made. Mock it to succeed. Assert circuit closes and subsequent calls are attempted.

4. **Flush on disconnect**: Enqueue 5 events. Call `disconnect()`. Assert flush POST is sent with 5 events before disconnect completes.

5. **Config cache TTL**: Call `refreshConfig()`. Assert HTTP GET. Call `getToolConfig()` immediately — assert no second HTTP call. Advance timer past TTL (5 min). Call `refreshConfig()` again. Assert second HTTP GET.

6. **Offline mode**: Create ApiService with empty API key. Assert `connect()` returns false. Assert all send methods are no-ops (no HTTP calls). Assert `getToolConfig()` returns null.

**Objective 1.2.3: Python SDK FuzeService**

Create `D:/fuze-python/src/fuze_ai/services/` with:
- `__init__.py` — exports
- `types.py` — `FuzeService` protocol (Python equivalent of the TS interface)
- `noop_service.py` — `NoopService` (default when no API key)
- `api_service.py` — `ApiService` with identical behavior to TypeScript version:
  - Batched telemetry with configurable flush interval
  - Config fetching with TTL cache
  - Circuit breaker (3 failures → 60s cooldown)
  - `httpx` for async HTTP (add to optional deps in pyproject.toml)

Integrate into `guard.py`:
- `create_run()` and `guard()` should use `create_service(config)` to get the appropriate service
- Module-level singleton like the TS version

Write Python tests in `D:/fuze-python/tests/test_api_service.py` that mirror all 6 TypeScript tests above. Use `pytest` + `pytest-asyncio` + `httpx` mock.

### Acceptance Criteria

- `grep -r "TelemetryTransport" packages/core/src/` returns 0 results
- All existing tests pass + 6 new ApiService tests + 3 export tests
- Python SDK has feature-parity FuzeService with matching test count
- `cd /d/fuze && npm test` passes
- `cd /d/fuze-python && python -m pytest` passes

---

## Prompt 1.3: HMAC Audit Chain Upgrade

### Context

The Fuze SDK writes audit trails as JSONL files via `TraceRecorder` (`D:/fuze/packages/core/src/trace-recorder.ts`). Each entry has a `recordType` field: `run_start`, `step`, `guard_event`, or `run_end`.

Currently, entries are plain JSON lines with no integrity protection. The existing test file `packages/core/test/trace-recorder.test.ts` has 5 tests covering basic JSONL output.

The cloud API at `D:/fuze-dashboard/cloud-api/src/services/hash.ts` already implements a SHA-256 hash chain for the `audit_entries` table in Supabase. This prompt adds HMAC-SHA256 signing to the SDK-side local audit chain as an additional tamper-detection layer.

Reference: AIR Platform's `audit_ledger.py` at https://github.com/airblackbox/air-langchain-trust (Apache 2.0) implements a similar HMAC audit chain in Python.

### Task

**Modify `packages/core/src/trace-recorder.ts`:**

1. Add a `signature` field to each `TraceEntry` type:
   ```typescript
   signature?: string  // HMAC-SHA256 hex string
   ```

2. Add a `prevHash` and `hash` field to each entry for hash chaining:
   ```typescript
   hash: string       // SHA-256 of the entry content (excluding hash and signature fields)
   prevHash: string   // hash of the previous entry (or '0'.repeat(64) for the first)
   ```

3. On first use, generate an HMAC key:
   - Path: `~/.fuze/audit.key` (use `os.homedir()`)
   - Generate: `crypto.randomBytes(32)`
   - Permissions: `0o600` (owner read/write only) — use `fs.chmodSync`
   - If file exists, read it. If not, create it.

4. For each entry, before appending to the buffer:
   - Compute `hash = SHA256(JSON.stringify(entryWithoutHashAndSignature))`
   - Set `prevHash` from the last entry's hash (or zeros for first)
   - Compute `signature = HMAC-SHA256(key, "${sequence}|${entryId}|${hash}|${prevHash}")`
   - Where `sequence` is a monotonically increasing counter starting at 0, and `entryId` is a UUID or the entry's natural ID

5. Add a `verifyChain(entries: TraceEntry[]): { valid: boolean; hmacValid: boolean; firstInvalidIndex?: number }` exported function.

6. **Backwards compatibility**: If an entry has no `signature` or `hash` field, `verifyChain` skips HMAC/hash verification for that entry (returns valid for it).

**Write tests in `packages/core/test/trace-recorder.test.ts` (append to existing):**

1. **Hash chain creation**: Record `startRun` + 3 `recordStep` + `endRun`. Flush. Parse JSONL. Assert each entry has `hash`, `prevHash`, `signature`. Assert `prevHash` of entry N+1 === `hash` of entry N. Assert entry 0's `prevHash` is 64 zeros.

2. **Tamper detection — data**: Create 10 entries, flush. Modify entry #5's `toolName`. Call `verifyChain()`. Assert `{ valid: false, firstInvalidIndex: 5 }`.

3. **Tamper detection — HMAC only**: Create 10 entries, flush. Replace entry #5's `signature` with a different hex string (keep data and hash intact). Call `verifyChain()`. Assert `{ hmacValid: false, firstInvalidIndex: 5 }` but hash chain itself is still valid up to that point.

4. **Backwards compatibility**: Create 5 entries WITHOUT hash/signature fields (simulate old format), then 5 entries WITH. Call `verifyChain()`. Assert all pass (old entries skipped, new entries verified).

5. **Key file creation**: Delete `~/.fuze/audit.key` if exists. Create a TraceRecorder. Assert file was created, is 32 bytes, has 0600 permissions.

6. **Key file reuse**: Create TraceRecorder twice (two instances). Record one entry each. Assert both entries have the same HMAC key (same signature for identical content).

**Python SDK**: Implement the same HMAC chain in `D:/fuze-python/src/fuze_ai/trace_recorder.py`. Use `hmac` and `hashlib` stdlib modules. Write matching tests.

### Acceptance Criteria

- All 5 existing trace recorder tests pass unchanged
- 6 new HMAC tests pass
- `verifyChain()` is exported from `fuze-ai` package
- Python SDK has matching implementation and tests
- Key file is NOT committed to git (add `audit.key` to any relevant .gitignore)

---

## Prompt 1.4: Cloud Infrastructure

### Context

The Fuze Cloud platform lives at `D:/fuze-dashboard/`:
- `cloud-dashboard/` — React 18 + Vite + Tailwind frontend (deployed at app.fuze-ai.tech)
- `cloud-api/` — Express 4 + TypeScript backend (deployed on GCP Cloud Run)

The backend uses **Supabase** (PostgreSQL) as its database. The Supabase client is at `cloud-api/src/services/db.ts`.

Authentication is via **Firebase Auth** with email/password and GitHub OAuth. Firebase config is in `cloud-dashboard/src/firebase.ts`. The API uses two auth middlewares:
- `cloud-api/src/middleware/firebase-auth.ts` — verifies Firebase JWT for dashboard API routes (`/api/*`)
- `cloud-api/src/middleware/api-key-auth.ts` — verifies Fuze API keys for SDK routes (`/v1/*`)

Existing routes are in `cloud-api/src/routes/`. Existing Supabase tables include: `organisations`, `projects`, `members`, `runs`, `steps`, `guard_events`, `compliance_profiles`.

Playwright E2E tests exist at `cloud-dashboard/tests/e2e/` (auth setup + 3 smoke tests).

### Sub-prompt 1.4.1: Firebase Auth + User Management

**What exists:** Authentication is ALREADY implemented. Login (`cloud-dashboard/src/views/auth/Login.tsx`), Signup (`cloud-dashboard/src/views/auth/Signup.tsx`), AuthContext (`cloud-dashboard/src/contexts/AuthContext.tsx`), OrgContext, AuthGuard, OrgGuard — all working. Playwright auth bridge is set up and passing.

**What's needed:**
1. API key management UI at `/settings/api-keys` — this route exists but check if the page is fully functional:
   - Display existing API keys (masked: `fuze_****...last4`)
   - Create new key (show full key ONCE, then only masked)
   - Revoke key (soft delete with `revoked_at` timestamp)
   - Copy-to-clipboard button

2. API key generation logic in `cloud-api/`:
   - Format: `fz_live_` prefix + 32 random hex characters (total 40 chars)
   - Store as SHA-256 hash in Supabase `api_keys` table (never store plaintext)
   - Return plaintext to user exactly once at creation time
   - Rate limit: max 10 active keys per org

3. Verify the `/v1/*` routes properly authenticate using `api-key-auth.ts` middleware

**Testing:**
- E2E (Playwright, add to `cloud-dashboard/tests/e2e/smoke/`): Navigate to `/settings/api-keys`. Create a new API key. Assert the key is displayed and starts with `fz_live_`. Revoke it. Assert it's marked as revoked.
- Integration test (in `cloud-api/`): POST to create API key → assert 200, key format correct. Use new key to call `GET /v1/health` → assert 200. Revoke key → call `GET /v1/health` again → assert 401.
- Unit test: API key format validation — `fz_live_[a-f0-9]{32}` regex match. Generate 100 keys, assert all unique.

### Sub-prompt 1.4.2: Supabase Schema + API Foundation

**What exists:** Some tables already exist. Check the current schema by reading `cloud-api/src/routes/*.ts` and the Supabase queries within.

**What's needed — new tables:**

Add these tables via Supabase migrations (create migration SQL files in `cloud-api/supabase/migrations/` or apply directly):

```sql
-- AI System Inventory
CREATE TABLE ai_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  description TEXT,
  risk_classification TEXT, -- 'prohibited', 'high', 'limited', 'minimal', null
  role TEXT CHECK (role IN ('provider', 'deployer')),
  responsible_person TEXT,
  deployment_date TIMESTAMPTZ,
  intended_purpose TEXT,
  sdk_agent_ids TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Compliance Evidence
CREATE TABLE compliance_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES compliance_profiles(id),
  system_id UUID NOT NULL REFERENCES ai_systems(id),
  article TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  data_json JSONB NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT now(),
  hash TEXT
);

-- Retention Policies
CREATE TABLE retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  min_months INT NOT NULL DEFAULT 6,
  max_months INT NOT NULL DEFAULT 24,
  auto_archive BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add HMAC fields to existing audit storage
ALTER TABLE steps ADD COLUMN IF NOT EXISTS hash TEXT;
ALTER TABLE steps ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE steps ADD COLUMN IF NOT EXISTS hmac_signature TEXT;
ALTER TABLE guard_events ADD COLUMN IF NOT EXISTS hash TEXT;
ALTER TABLE guard_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE guard_events ADD COLUMN IF NOT EXISTS hmac_signature TEXT;
```

**New API endpoints** (add to `cloud-api/src/routes/`):

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/systems` | Firebase | List AI systems for org |
| POST | `/api/systems` | Firebase | Create/update AI system |
| GET | `/api/systems/:id` | Firebase | Get system details |
| DELETE | `/api/systems/:id` | Firebase | Retire system (soft delete) |
| GET | `/api/compliance/posture/:systemId` | Firebase | Compliance status per Article |
| POST | `/api/compliance/evidence/generate/:systemId` | Firebase | Trigger evidence generation |
| GET | `/api/audit/search` | Firebase | Search audit entries with filters |
| GET | `/api/audit/verify/:systemId` | Firebase | Verify hash chain integrity |
| POST | `/v1/events` | API Key | Enhanced: accept HMAC fields in batch events |

**Testing:**
- Unit test per new endpoint: valid request → 200 with expected shape. Missing required fields → 400. Unauthorized → 401.
- Integration test: Create AI system → ingest telemetry via `/v1/events` → query system → assert telemetry linked to system via `sdk_agent_ids`.
- Schema test: Run migrations on empty database → assert all tables exist with correct columns.

### Sub-prompt 1.4.3: Stripe Billing Foundation

**What's needed:**

1. Install `stripe` npm package in `cloud-api/`
2. Create `cloud-api/src/services/stripe.ts` — Stripe client initialization
3. Create `cloud-api/src/routes/billing.ts`:
   - `POST /api/billing/checkout` — create Stripe Checkout session for plan upgrade
   - `GET /api/billing/portal` — create Stripe Customer Portal session
   - `GET /api/billing/status` — current subscription status + usage
   - `POST /api/billing/webhook` — Stripe webhook endpoint (NOT behind Firebase auth)

4. Stripe Products (create via Stripe dashboard or API):
   - **Comply Starter**: €199/mo, metadata: `{ tier: 'starter', trace_limit: 50000 }`
   - **Comply Pro**: €499/mo, metadata: `{ tier: 'pro', trace_limit: 500000 }`

5. Webhook handlers for:
   - `customer.subscription.created` → update org subscription status
   - `customer.subscription.updated` → update tier
   - `customer.subscription.deleted` → downgrade to free
   - `invoice.payment_failed` → flag org, start 7-day grace period

6. Usage tracking:
   - Add `trace_count_current_period` and `trace_limit` columns to `organisations` table
   - Increment counter on each `/v1/events` batch ingestion
   - Reset counter on billing period change (via webhook)
   - Return 429 when limit exceeded

7. Add billing UI components in `cloud-dashboard/src/views/settings/`:
   - Billing page showing current plan, usage meter, upgrade/manage buttons

**Testing:**
- Unit tests using Stripe test mode / mocked Stripe client:
  1. Create checkout session → assert Stripe API called with correct price ID
  2. Webhook: `subscription.created` → assert org status updated to 'active'
  3. Webhook: `subscription.deleted` → assert org status updated to 'free'
  4. Webhook: `payment_failed` → assert grace period flag set
  5. Usage counter: ingest 100 events → assert counter = 100
  6. Usage limit: counter at limit → next ingestion returns 429

### Acceptance Criteria

- All new Supabase tables created and migrations are idempotent
- All API endpoints return correct responses
- Stripe webhook handling is tested with mock events
- Usage metering is accurate and limit enforcement works
- E2E test for API key management passes
- Existing Playwright tests still pass

---

## Prompt 1.5: Risk Classification Wizard

### Context

The marketing website at `D:/fuze-web/` is a Next.js 16 site deployed at fuze-ai.tech. It already has an `src/app/eu-ai-act/` route. The wizard should live at `/classify` (new route).

The classification logic is based on the EU AI Act's risk tiers:
- **Prohibited** (Art. 5): subliminal manipulation, social scoring, real-time biometric identification (with exceptions), emotion recognition in workplace/education
- **High-Risk** (Art. 6 + Annex III): biometric identification, critical infrastructure, education, employment, essential services, law enforcement, migration, justice
- **Limited Risk** (Art. 50): chatbots, deepfakes, emotion recognition (non-prohibited)
- **Minimal Risk**: everything else

Reference: Algorithm Audit's AI Act Implementation Tool at https://github.com/NGO-Algorithm-Audit/AI-Act-Implementation-Tool — uses JSON schema for classification questions (EUPL-1.2 license). Study their `src/schemas/en/riskclassification.json` for the question structure and decision tree logic.

### Sub-prompt 1.5.1: Classification Decision Tree Engine

**Create `D:/fuze-web/src/lib/classification/`:**

1. `schema.json` — Data-driven classification questions. Each question has:
   ```typescript
   interface Question {
     id: string
     text: string
     articleRef: string      // e.g., "Art. 5(1)(a)"
     helpText: string        // tooltip explaining the legal context
     options: { label: string; value: string; next: string | null }[]
   }
   ```
   Questions should cover:
   - Is the system an AI system per Art. 3(1)?
   - Provider vs Deployer role (Art. 3(3), 3(4))
   - Art. 5 prohibited practice checks (4 categories)
   - Annex III high-risk checks (8 categories)
   - Art. 6(3) exception checks (research, defense, personal use, purely preparatory)
   - GPAI model checks (Art. 51-55)

2. `engine.ts` — Classification engine that processes answers:
   ```typescript
   interface ClassificationResult {
     riskTier: 'prohibited' | 'high' | 'limited' | 'minimal'
     role: 'provider' | 'deployer' | 'both'
     applicableArticles: string[]
     obligations: string[]
     recommendedActions: string[]
     annexIIICategory?: string
   }

   function classify(answers: Record<string, string>): ClassificationResult
   ```

   The engine must be pure logic with NO React/UI dependencies. All business rules come from `schema.json`.

3. `obligations.json` — Maps risk tier + role to specific obligations:
   - High-risk provider: Art. 9, 10, 11, 12, 13, 14, 15, 16, 17
   - High-risk deployer: Art. 26, 27
   - Limited risk: Art. 50
   - Minimal: voluntary codes of conduct only

**Testing (in `D:/fuze-web/` using the project's test framework, or create `__tests__/` with vitest):**

1. **Annex III categories** (8 tests): For each Annex III category (biometric, critical infrastructure, education, employment, essential services, law enforcement, migration, justice), provide answers that match that category → assert `riskTier === 'high'` and correct `annexIIICategory`.

2. **Prohibited cases** (4 tests): Subliminal manipulation → prohibited. Social scoring → prohibited. Real-time biometric mass surveillance (without exception) → prohibited. Emotion recognition in workplace → prohibited.

3. **Art. 6(3) exceptions** (4 tests): Research only → exempt from high-risk. Defense → exempt. Personal use → exempt. Purely preparatory → exempt.

4. **Role determination** (3 tests): Developer of AI system → provider. User of existing system → deployer. Deployer making substantial modifications → provider (Art. 25).

5. **Snapshot tests** (5 tests): For 5 representative scenarios, assert full `ClassificationResult` matches JSON snapshot.

### Sub-prompt 1.5.2: Wizard UI + PDF Report

**Create `D:/fuze-web/src/app/classify/`:**

1. `page.tsx` — Main wizard page with:
   - Progress bar showing current step / total steps
   - Question display with radio button options
   - Legal citation tooltip on each question (shows Article reference)
   - Back/Next navigation
   - Animated transitions between questions

2. `results.tsx` — Results component showing:
   - Risk tier badge (color-coded: red=prohibited, orange=high, yellow=limited, green=minimal)
   - Applicable Articles list with brief descriptions
   - Obligations checklist
   - Recommended next steps (link to Fuze Cloud signup for high-risk)
   - "Download PDF Report" button
   - Optional email capture (for lead nurture — use a simple form that POSTs to a serverless function or Supabase)

3. `pdf.tsx` — PDF generation using `@react-pdf/renderer` (or similar):
   - Company/system name (entered in wizard)
   - Date of classification
   - All answers given
   - Classification result
   - Applicable obligations with Article references
   - Fuze branding and disclaimer

4. SEO optimization:
   - Page title: "EU AI Act Risk Classification Wizard | Fuze"
   - Meta description
   - OpenGraph tags
   - Structured data (FAQ schema for common questions)

**Testing:**
- E2E (Playwright, set up in `D:/fuze-web/`):
  1. Navigate to `/classify`. Complete wizard selecting "employment screening" answers. Assert result shows "High Risk" with Art. 6 and Annex III.4.
  2. Complete wizard with "spam filter" answers. Assert "Minimal Risk".
  3. Click "Download PDF". Assert a file downloads and is > 0 bytes.
  4. Complete wizard without entering email. Assert wizard completes (email is optional).
  5. Visual regression: screenshot each wizard step.

### Acceptance Criteria

- `/classify` route is accessible, no login required
- Classification engine has 24+ passing unit tests
- 5 Playwright E2E tests pass
- PDF downloads correctly
- Lighthouse performance score > 90
- Mobile responsive (test at 375px width)

---

## Prompt 1.6: Compliance Posture Dashboard

### Context

The cloud dashboard at `D:/fuze-dashboard/cloud-dashboard/` has an existing compliance route at `/compliance` (`src/views/Compliance.tsx`). The cloud API has `cloud-api/src/routes/compliance.ts` and `cloud-api/src/routes/compliance-profile.ts`.

The compliance posture engine maps SDK telemetry (runs, steps, guard events stored in Supabase) to EU AI Act Article compliance status. This is the core value proposition of Fuze Comply.

References:
- Attestix `services/compliance_service.py` (Apache 2.0): https://github.com/VibeTensor/attestix — study their obligation mapping pattern
- Comp `frameworks-scores.helper.ts` (AGPLv3 — study only, do not copy): https://github.com/trycompai/comp — study their scoring approach

### Sub-prompt 1.6.1: Compliance Model Engine

**Create `cloud-api/src/services/compliance-engine.ts`:**

This is a pure-logic module (no HTTP, no DB — receives data, returns status).

```typescript
interface ArticleCheck {
  article: string           // e.g., "Art. 9"
  title: string             // e.g., "Risk Management System"
  status: 'satisfied' | 'partial' | 'manual_attestation' | 'not_addressed'
  score: number             // 0.0 to 1.0
  checks: CheckResult[]     // individual sub-checks
  remediation?: string      // what to do if not satisfied
}

interface CompliancePosture {
  systemId: string
  riskTier: string
  overallScore: number       // weighted average 0-100
  articles: ArticleCheck[]
  generatedAt: string
}
```

Per-Article checkers:

| Article | Auto-checks (from telemetry) | Manual attestation fields |
|---------|------------------------------|--------------------------|
| Art. 9 (Risk management) | Risk classification completed (ai_systems.risk_classification not null), guard() configured with thresholds (telemetry shows guard events) | Risk assessment document uploaded |
| Art. 12 (Record-keeping) | Audit logging active (runs/steps exist in last 30 days), hash chain valid (verify endpoint passes), retention policy configured (retention_policies exists for org) | — |
| Art. 13 (Transparency) | System has description and intended_purpose filled in ai_systems | Transparency disclosure published |
| Art. 14 (Human oversight) | Kill switch evidence (guard events with type 'kill'), at least 1 org member with 'admin' role | Human oversight procedure documented |
| Art. 15 (Accuracy/robustness) | guard() active (steps recorded), loop detection enabled (loop guard events OR config shows loop detection), budget enforcement active (budget guard events OR config shows budget) | Performance benchmarks documented |
| Art. 26 (Deployer obligations) | Composite: aggregates Art. 9, 12, 13, 14, 15 for deployer role | — |
| Art. 72 (Post-market monitoring) | Telemetry flowing in last 7 days, FuzeService connected (health check passes) | Monitoring plan documented |

Scoring:
- `satisfied` = 1.0 (all auto-checks pass)
- `partial` = 0.5 (some auto-checks pass)
- `manual_attestation` = 0.3 (auto-checks pass but manual confirmation needed)
- `not_addressed` = 0.0
- Overall = weighted average (Art. 9 and Art. 12 weighted 2x because they're foundational)

**Wire it into the API:**
- `GET /api/compliance/posture/:systemId` calls the engine with data from Supabase and returns `CompliancePosture`

**Testing:**

1. **Per-Article satisfied** (7 tests): For each Article, provide telemetry data that satisfies all auto-checks → assert status = `satisfied`, score = 1.0.
2. **Per-Article not_addressed** (7 tests): For each Article, provide empty telemetry → assert status = `not_addressed`, score = 0.0.
3. **Partial compliance**: Art. 12 with logging active but no retention policy → assert `partial`, score = 0.5.
4. **Overall score calculation**: 3 satisfied (1.0), 2 partial (0.5), 2 not_addressed (0.0) → assert correct weighted average.
5. **Integration test (Medicore)**: Run the Medicore harness happy-path test (`D:/medicore/tests/integration/medicore/scenarios/happy-path.test.ts` pattern). Configure FuzeService to point at a test instance of the cloud API. After the Medicore run completes, query `/api/compliance/posture/{systemId}` → assert Art. 12 (record-keeping) and Art. 15 (accuracy) show `satisfied` or `partial`.

### Sub-prompt 1.6.2: Dashboard UI

**Modify `D:/fuze-dashboard/cloud-dashboard/src/views/Compliance.tsx`** (or create new components):

1. **System selector**: Dropdown to pick which AI system to view (from `/api/systems`)
2. **Overall score**: Circular progress ring with percentage
3. **Article cards**: Grid of cards, one per applicable Article:
   - Traffic light icon (green/yellow/orange/red based on status)
   - Article number and title
   - Status label
   - Click to expand: shows individual checks, remediation steps
4. **Gap list**: Expandable panel showing `not_addressed` and `partial` Articles with actionable remediation
5. **Export PDF**: Button that generates a compliance report PDF (calls `/api/compliance/evidence/generate/:systemId`)
6. **Auto-refresh**: Poll posture endpoint every 60 seconds (or use SWR/React Query with refetchInterval)

**Testing (Playwright, add to `cloud-dashboard/tests/e2e/`):**
1. Navigate to `/compliance`. Assert compliance score is visible (number or progress ring).
2. Assert at least one Article card is rendered with a status indicator.
3. Click on a `not_addressed` or `partial` Article card. Assert remediation text appears.
4. Click "Export PDF". Assert file downloads.

### Acceptance Criteria

- Compliance engine has 15+ unit tests
- Dashboard renders within 2 seconds
- All Playwright tests pass
- Medicore integration test demonstrates end-to-end compliance posture flow

---

## Prompt 1.7: Compliance Evidence Generator

### Context

EU AI Act Annex IV defines the required technical documentation structure for high-risk AI systems. This prompt builds an engine that auto-generates as much of this documentation as possible from SDK telemetry data, and clearly marks what needs manual input.

References:
- EuConform `packages/core/src/legal-checks/annex-iv-report.ts` (MIT): https://github.com/Hiepler/EuConform — study their 7-section schema mapping
- Attestix `services/compliance_service.py` (Apache 2.0): https://github.com/VibeTensor/attestix — study their Annex V Declaration of Conformity field mapping

### Task

**Create `cloud-api/src/services/evidence-generator.ts`:**

```typescript
interface EvidenceReport {
  id: string
  systemId: string
  version: number
  generatedAt: string
  sections: EvidenceSection[]
  sourceHashes: string[]  // hashes of audit records used as source
}

interface EvidenceSection {
  number: number           // 1-7
  title: string
  annexIVRef: string       // e.g., "Annex IV, Section 2"
  fields: EvidenceField[]
}

interface EvidenceField {
  label: string
  value: string | null
  source: 'auto_generated' | 'manual_input'
  sourceDescription: string  // e.g., "From SDK guard() configuration" or "User must provide"
}
```

**7 sections following Annex IV:**

1. **General Description** (auto from `ai_systems` table):
   - System name, description, intended purpose, deployment date
   - Provider/deployer identification
   - Risk classification result

2. **Design Specifications** (auto from SDK telemetry):
   - SDK version (from telemetry metadata)
   - Guard configuration (timeouts, budgets, loop detection settings)
   - Registered tools list (from `registerTools()` telemetry)
   - Model providers used (extracted from pricing/cost data)

3. **Data Management** (manual attestation):
   - Training data description → `manual_input` with template
   - Data governance procedures → `manual_input` with template
   - Bias mitigation measures → `manual_input` with template

4. **Risk Management** (auto from classification + guard config):
   - Risk classification result and methodology
   - Guard thresholds as risk mitigation measures
   - Loop detection as safety mechanism
   - Budget enforcement as resource control

5. **Performance & Monitoring** (auto from run statistics):
   - Total runs in period, success/failure rates
   - Average cost per run, total cost
   - Guard event frequency (loops detected, budget exceeded, timeouts)
   - Average latency per step

6. **Human Oversight** (partial auto, partial manual):
   - Org members with admin role → auto
   - Kill switch configuration → auto (from guard events)
   - Oversight procedures → `manual_input` with template

7. **Technical Documentation** (auto from SDK metadata):
   - SDK package version
   - Node.js / Python version
   - Dependencies list
   - API configuration (endpoints, auth method)

**Wire into API:**
- `POST /api/compliance/evidence/generate/:systemId` — generates report, stores in `compliance_evidence` table, returns report
- `GET /api/compliance/evidence/:systemId` — list generated reports with version history
- `GET /api/compliance/evidence/:systemId/:reportId` — get specific report
- `GET /api/compliance/evidence/:systemId/:reportId/pdf` — download as PDF

**PDF generation**: Use a server-side PDF library (e.g., `pdfkit` or `@react-pdf/renderer` in a Node context). The PDF should include:
- Fuze logo and branding
- Report metadata (system name, date, version)
- All 7 sections with clear `auto_generated` vs `manual_input` labels
- Hash verification footer (source audit record hashes)

**Testing:**

1. **Full report generation**: Create ai_system with telemetry data. Call generate. Assert all 7 sections present. Assert auto fields are non-empty. Assert manual fields have template text.

2. **Empty system**: Create ai_system with NO telemetry. Call generate. Assert sections exist but auto fields show "No data available" or similar. Assert manual fields still have templates.

3. **Hash verification**: Generate report. Assert `sourceHashes` array is non-empty. Verify each hash matches an actual audit record in the database.

4. **Version history**: Generate report twice for same system. Assert version increments (1, 2). Assert both accessible via list endpoint.

5. **Integration test (Medicore)**: Run Medicore happy-path → generate evidence for the medicore-agent system → assert Section 5 (Performance) contains actual run statistics (non-zero runs, steps, costs).

### Acceptance Criteria

- 5+ unit tests + 1 integration test pass
- PDF opens correctly in browser and Adobe Reader
- Evidence generation completes in < 5 seconds
- `manual_input` fields have clear, helpful template text that guides the user

---

## Prompt 1.8: AI System Inventory

### Context

This prompt builds the AI System Inventory — a registry of all AI systems in an organization. Systems can be manually created or auto-discovered when the SDK sends telemetry with an unknown `agent_id`.

The `ai_systems` table was created in Prompt 1.4.2. The API endpoints (`/api/systems`) were also defined there. This prompt focuses on the dashboard UI and the auto-discovery logic.

### Task

**Auto-discovery logic in `cloud-api/src/routes/ingest.ts` (the `/v1/events` endpoint):**

When a telemetry batch arrives with a `run_start` event containing an `agentId`:
1. Look up `ai_systems` where `sdk_agent_ids @> ARRAY[agentId]` for the project's org
2. If no match found:
   - Create a new `ai_systems` entry with:
     - `name`: the agentId (user can rename later)
     - `status`: 'draft'
     - `sdk_agent_ids`: [agentId]
     - `org_id`: from the project's org
   - Return the new system ID in the ingestion response
3. If match found: no action needed (system already linked)

**Dashboard UI at `D:/fuze-dashboard/cloud-dashboard/src/views/`:**

Create or update a Systems/Inventory view:

1. **Table view**: Sortable/filterable table showing:
   - Name (editable inline)
   - Risk classification (badge: red/orange/yellow/green/gray)
   - Role (provider/deployer)
   - Status (draft/active/retired)
   - Last telemetry (relative time)
   - Actions (edit, retire, classify)

2. **Create system modal**: Form with name, description, role, intended purpose. After creation, option to "Run Classification Wizard" (links to fuze-ai.tech/classify with pre-filled system name).

3. **System detail page**: `/systems/:id` showing:
   - Editable fields (name, description, role, responsible person, purpose)
   - Linked SDK agent IDs (add/remove)
   - Classification result (if linked)
   - Recent runs from this system
   - Compliance posture summary (links to `/compliance`)

4. **Export**: CSV and PDF export of the inventory table

**Testing:**

1. **CRUD** (unit tests in cloud-api): Create → Read → Update → Delete system. Assert each operation works correctly.
2. **Auto-discovery**: POST telemetry batch with agentId "new-agent-xyz" → assert new ai_system created with status 'draft'.
3. **Auto-discovery dedup**: POST telemetry twice with same agentId → assert only 1 system entry.
4. **Classification linkage**: Create system, then update its `risk_classification` field → assert it appears with correct badge in list.
5. **Export**: Create 5 systems. Call CSV export endpoint. Assert CSV has 5 rows with correct columns.
6. **E2E (Playwright)**: Navigate to systems/inventory view. Create a new system via modal. Assert it appears in the table.

### Acceptance Criteria

- 6+ tests pass
- Auto-discovery creates draft entries for unknown agent IDs
- Table view is sortable and filterable
- CSV/PDF export works
- Playwright E2E test passes

---

## Prompt 1.9: Log Retention & Integrity

### Context

EU AI Act Art. 12 requires that logs of high-risk AI systems be kept for a minimum period. This prompt implements configurable log retention with hash chain integrity verification.

The `retention_policies` table was created in Prompt 1.4.2. The audit data is stored in `runs`, `steps`, and `guard_events` tables in Supabase.

### Task

**Create `cloud-api/src/services/retention.ts`:**

```typescript
interface RetentionConfig {
  orgId: string
  minMonths: number   // minimum retention (default 6, EU AI Act minimum)
  maxMonths: number   // maximum retention (default 24)
  autoArchive: boolean // archive to cold storage before deletion
}

async function enforceRetention(config: RetentionConfig): Promise<RetentionResult>
async function archiveEntries(orgId: string, before: Date): Promise<ArchiveResult>
async function verifyHashChain(systemId: string, from?: Date, to?: Date): Promise<VerificationResult>
```

**Retention enforcement:**
1. Query entries older than `maxMonths` for the org
2. If `autoArchive`: export to GCS bucket (`gs://fuze-audit-archive/{orgId}/{year}/{month}.jsonl.gz`) as gzipped JSONL
3. Delete archived entries from primary Supabase tables
4. Log the retention action (entries archived, entries deleted, date range)

**Supabase table partitioning** (optional optimization):
- If feasible, partition `steps` and `guard_events` by month for efficient range deletion
- If not feasible with Supabase, use date-range DELETE queries with LIMIT batching (1000 rows per batch to avoid long locks)

**Hash chain verification endpoint** (`/api/audit/verify/:systemId`):
1. Fetch all `steps` for the system ordered by `created_at`
2. Verify SHA-256 hash chain: each entry's `prev_hash` matches previous entry's `hash`
3. If HMAC fields present: verify HMAC signatures using org's HMAC key
4. Return:
   ```typescript
   interface VerificationResult {
     valid: boolean
     hmacValid: boolean
     entriesChecked: number
     firstInvalidIndex?: number
     firstInvalidHmacIndex?: number
   }
   ```

**Cron job** (GCP Cloud Scheduler → Cloud Run):
- Daily at 03:00 UTC: call retention enforcement for all orgs with configured policies
- Create the Cloud Scheduler config (document in a README or infra-as-code file)

**Storage quota tracking:**
- Add `storage_used_bytes` column to `organisations` table
- Update on telemetry ingestion (estimate: ~500 bytes per step entry)
- Alert when org reaches 80% of tier quota (email or dashboard notification)

**Retention management UI** in dashboard at `/settings`:
- Current retention policy (min/max months, auto-archive toggle)
- Storage usage meter
- Manual "Verify Integrity" button that calls the verify endpoint
- Verification result display (green checkmark or red warning with details)

**Testing:**

1. **Retention enforcement**: Create entries spanning 8 months. Set policy to 6 months max. Run enforcement. Assert months 7-8 are deleted. Assert months 1-6 remain.
2. **Idempotency**: Run enforcement twice on same data. Assert no double-deletion (second run finds nothing to delete).
3. **Archive**: Create 100 entries in month 7-8. Run enforcement with `autoArchive: true`. Assert GCS upload was called with correct path and gzipped JSONL content. Mock GCS client.
4. **Hash chain valid**: Create 100 entries with proper hash chain. Call verify. Assert `{ valid: true, entriesChecked: 100 }`.
5. **Hash chain tampered**: Create 100 entries. Modify entry #50's data without updating hash. Call verify. Assert `{ valid: false, firstInvalidIndex: 50 }`.
6. **HMAC verification**: Create 100 entries with HMAC fields. Tamper with entry #50's HMAC. Assert `{ hmacValid: false, firstInvalidHmacIndex: 50 }`.
7. **Storage quota alert**: Ingest entries until 80% of quota. Assert alert/notification is generated.

### Acceptance Criteria

- 7+ tests pass
- Retention enforcement is idempotent
- Hash chain + HMAC verification works end-to-end
- Cron job configuration is documented
- Dashboard UI shows retention settings and integrity verification
- All existing tests still pass
