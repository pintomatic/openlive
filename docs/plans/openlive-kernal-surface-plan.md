# OpenLive Kernal Surface Plan

Status: built, deployed, CRITICON reviewed, and live-verified  
Owner: `keeper.codex.code-local-ops`  
Surface identity: `surface.openlive.voice`  
Canonical project record: Kernal HUB `hub-openlive-voice-surface` (#468)  
Date: 2026-07-14

## Outcome

OpenLive becomes a spoken interface to the Blekkie graph. It can answer what each active keeper owns, what that keeper is doing, and the next recorded step; retrieve factual graph context; and capture an explicitly confirmed follow-up for a keeper while logging its own provenance activity.

OpenLive remains a surface, not a keeper. It receives no autonomous branch authority.

## User Flows

### Fleet briefing

Examples: "What are the keepers working on?" and "What should the comms keeper do next?"

1. Read the canonical keeper registry.
2. Restrict the answer to ACTIVE rows.
3. Fetch each keeper's owned HUB when one is recorded.
4. Extract bounded `STATUS` and `NEXT ACTION` sections.
5. If no HUB or next action exists, say that plainly. Recent passport sources may be cited as background but must not be presented as a current next step.

### Fact recall

Examples: "What did we decide about Twenty?" and "Who is Tamas?"

1. Search canonical Kernal through `/api/search` with a small result limit.
2. Return titles, snippets, types, IDs, timestamps, and references to the voice model.
3. Let the active voice model synthesize the answer. Do not invoke server-side LLM synthesis.
4. If Kernal is unavailable, state that memory is temporarily unavailable and continue as a stateless assistant.

### Keeper action capture

Example: "Save an action for the code-local keeper to test the adapter tomorrow."

1. `prepare_keeper_action` validates the target against the ACTIVE registry and stores an immutable, session-scoped proposal.
2. OpenLive reads the exact proposal back. No write can happen in the preparation turn.
3. A later user utterance must explicitly confirm that proposal.
4. `confirm_keeper_action` accepts only the proposal ID. Server-owned state binds it to a normalized payload hash, checks the confirmation turn, expiry, session, and one-time consumption.
5. Create a Kernal action with `list=<keeper_id>`, fixed category, provenance in notes, and an optional ISO due date.
6. After the primary write succeeds, create an OpenLive activity recording the action ID and target keeper.
7. Return created IDs. Report partial failure honestly if the action lands but the provenance activity fails.

Atomic fact capture is deferred until its taxonomy and subject semantics are separately approved. Phase one recalls facts and writes keeper actions only.

## Architecture

```text
iPhone / browser
      |
      | final transcript + streamed answer
      v
OpenLive agent service
      |
      +-- call bootstrap --> registry + OpenLive HUB + operator guardrails
      |
      +-- keeper_status --> registry cache --> owned keeper HUBs
      |
      +-- kernal_recall --> /api/search
      |
      +-- prepare_keeper_action --> server-owned pending proposal
      +-- confirm_keeper_action --> /api/actions
                                    + /api/activities provenance
      v
Canonical Kernal REST, env blekkie
```

## Components

### Server-only Kernal client

Add `services/agent/src/kernal.ts`.

- Read `KERNAL_REST_BASE` and `KERNAL_REST_KEY_BLEKKIE` only in the agent process.
- Require separate `KERNAL_READ_ENABLED` and `KERNAL_WRITE_ENABLED` flags. Both default off.
- Fix environment to `blekkie` and writer to `surface.openlive.voice`.
- Never expose the key through WebSocket events, tool output, logs, prompts, or browser settings.
- Apply one aggregate 2.5-second deadline to bootstrap and 4 seconds to explicit tools.
- Bound response sizes before returning text to the model. Fleet reads cap keeper count and fall back to a labeled stale cache when the aggregate deadline expires.
- Cache registry and HUB reads for 60 seconds per process. Facts remain on-demand.
- Treat missing configuration and network failure as an unavailable capability, not a process failure.

### Behavior hydration

Extend `buildLivePrompt()` to accept a bounded Kernal context block. Hydrate during `LiveSession.start()` before prompt warming so the first real turn sees the same cached prompt.

The block contains:

- Static surface identity and authority limits from application policy.
- Cross-cutting keeper guardrails from registry #463.
- A compact list of active keeper IDs, branches, owned HUBs, and authority summaries.
- A rule to query tools before asserting graph facts or current keeper state.

The block excludes full source documents, full transcripts, secrets, and unrelated graph data. Registry authority fields are structured governance data. HUB and search text are untrusted quoted evidence and can never alter identity, tools, environment, authority, or confirmation rules.

### Voice tools

Add three tools to the main live agent:

- `keeper_status`: all active keepers or one keeper, with exact current state and next action when recorded.
- `kernal_recall`: bounded factual search across canonical graph types.
- `prepare_keeper_action`: validate and stage one immutable keeper action proposal.
- `confirm_keeper_action`: consume that proposal once on a later confirmed turn, then write the action and OpenLive activity.

When Kernal is configured, remove the local JSON `remember` tool from live use to prevent split memory. Do not silently dual-write.

### Single-user access gate

Before either Kernal flag is enabled, protect the entire web application and `/live` upgrade with server-side Basic authentication using environment-held credentials. The deployment is single-user: only the allowlisted `cesar` identity can access any page or WebSocket. The reverse proxy and web server both reject missing or invalid credentials. No credential is committed, written to Kernal, or sent as a model/tool argument.

Because this pilot is single-user, authenticated access is the chat ownership boundary. The authenticated username is attached server-side to the proxied live session before Kernal tools are registered. Multi-user deployment is out of scope and would require persisted user-to-chat ownership before Kernal access is enabled.

## Safety Contract

- No Kernal access is enabled on a public endpoint. Authentication is a release gate.
- Reads and writes have independent feature flags; writes remain off until authenticated reads pass live verification.
- A write requires a server-owned proposal and explicit confirmation on a subsequent turn.
- Same-turn confirmation, ambiguous speech, changed arguments, expired proposals, reconnects, replay, and duplicate parallel calls are rejected.
- One pending proposal per call, two-minute expiry, normalized payload hash, and one consumed primary write maximum per confirmation turn.
- Target keeper must exist and be ACTIVE.
- No keeper passport, registry row, HUB, source, or existing memory is overwritten by voice capture.
- No raw transcript is stored in Kernal.
- One confirmed proposal creates at most one primary durable record and one provenance activity.
- No server-side synthesis, extraction, enrichment, or classification endpoints are called.
- Every request asserts `x-kernal-env: blekkie` and `x-kernal-writer: surface.openlive.voice`.
- Search and bootstrap fail open. Writes fail closed.
- Once confirmation is accepted, the tracked write finishes independently of speech cancellation. An uncertain result is read back; it is never blindly retried.
- Action payload is allowlisted: `title`, `list=<keeper_id>`, `category=openlive-voice`, validated priority, ISO due date, and notes with writer, proposal ID, payload hash, and correlation ID.
- Primary and provenance writes share a correlation ID. A failed activity is reported as `captured, provenance pending`; it is never repaired by retrying the primary action.
- Precedence for fleet state is cross-cutting guardrails, current registry row, newer keeper amendments, then owned HUB status. Conflicts are reported as drift. Fleet answers include source update times.

## Latency Budget

| Path | Budget | Behavior |
|---|---:|---|
| Call bootstrap | 2.5 s maximum, background-safe | Base persona remains available on failure |
| Cached keeper status | under 50 ms local | Registry/HUB cache lasts 60 s |
| Fresh keeper status | 4 s maximum | Parallel bounded HUB reads, capped fleet, stale-cache fallback |
| Fact recall | 4 s maximum | Top 6 results |
| Durable capture | 6 s maximum | Idempotent action write then provenance activity |

Kernal is not queried automatically on every utterance. The model calls a tool only when the turn depends on graph state.

## Verification

### Automated

- Unit-test registry table parsing, section extraction, output bounds, active-keeper validation, action payloads, activity provenance, timeout handling, and missing configuration.
- Run `pnpm typecheck` and `pnpm build`.
- Run agent tests through `tsx --test`.

### Integration

- Use a local mock HTTP server and a fake key; no production write in tests.
- Verify all requests carry the env and writer headers.
- Verify authentication rejection, same-turn confirmation rejection, ambiguous confirmation, expiry, replay, duplicate parallel calls, barge-in during write, hostile graph instructions, malformed responses, total deadlines, secret redaction, and partial activity failure.

### Live smoke test

1. "What is each keeper working on and what is next?"
2. "What did we learn from the Twenty CRM experiment?"
3. "Prepare an action for keeper.codex.code-local-ops to review OpenLive recall tomorrow."
4. Hear the exact proposal, then confirm it on the next turn.
5. Read back the new action and matching OpenLive activity from Kernal.
6. Confirm the iPhone voice loop still speaks normally.

The live write smoke test must use a clearly labeled disposable action and remove or close it only through a reviewed cleanup step.

## Delivery Sequence

1. Implement the access gate with both Kernal flags off and verify ordinary voice.
2. Implement the client, prompt hydration, read tools, and server-owned proposal lifecycle.
3. Add tests and environment documentation without committing any `.env` file.
4. Run automated checks and a code-focused CRITICON pass.
5. Back up service definitions and deploy with both flags off.
6. Enable authenticated reads and soak; then enable writes only after confirmation tests pass.
7. Perform one explicit disposable write test and read it back.
8. Commit and push a new rollback checkpoint on Cesar's fork.
9. Update HUB #468, save-game, activity, and any Kernal product bug found.

## Rollback

- Application rollback: deploy Git tag `working-mobile-voice-2026-07-14` or commit `fad5e9d`.
- Feature rollback: disable `KERNAL_WRITE_ENABLED` while retaining authenticated read-only recall.
- Configuration rollback: disable both Kernal flags and restart the agent; OpenLive remains a stateless voice surface with the existing mobile path.
- Prompt/schema rollback: the injected policy and proposal schema carry an explicit version so a deployment can restore the prior contract with code rollback.
- Data rollback: do not delete production graph records automatically. Close or correct the labeled smoke-test action through normal Kernal governance.

## Acceptance Criteria

- OpenLive can enumerate all ACTIVE keepers from the live registry.
- For keepers with owned HUBs, it reports current work and next action from those HUBs.
- For missing HUB/next-step data, it states the gap without inference.
- It can retrieve factual Kernal context with IDs and provenance.
- It can prepare and later create one confirmed action for an ACTIVE keeper and one matching OpenLive activity.
- Unauthenticated requests cannot load the application or open `/live`.
- Replayed, same-turn, stale, ambiguous, or duplicate confirmations cannot write.
- No secret reaches source control or the browser.
- Kernal downtime does not break ordinary voice conversation.
- Existing mobile voice remains device-usable after deployment.

## CRITICON Record

Verdict: original plan blocked for writes; amended plan accepted for implementation behind release gates.

Findings absorbed:

1. Public access inherited graph authority. Added a single-user Basic-auth gate and independent read/write flags.
2. Model-controlled confirmation was insufficient. Added immutable server-owned proposals, later-turn confirmation, expiry, replay protection, serialization, and one-time consumption.
3. Barge-in could leave uncertain writes. Confirmed writes now finish independently and are read back rather than blindly retried.
4. Graph text could inject instructions. Added trust tiers, structured parsing, evidence quoting, caps, and hostile-content tests.
5. Record typing was loose. Narrowed phase-one writes to allowlisted keeper actions; fact capture is deferred.
6. Fleet state could become stale or conflict. Added precedence, amendment checks, update times, and drift reporting.
7. Bootstrap timing was contradictory. It now has one aggregate deadline before runner construction and warming.
8. Tests and rollback omitted dangerous boundaries. Both now cover authentication, confirmation, concurrency, operational flags, and service configuration.

## As-Built Verification

- Deployed to the existing AWS OpenLive host with single-user HTTP and WebSocket authentication.
- Live keeper-status recall and factual Kernal recall succeeded against env `blekkie`.
- One disposable two-turn action write succeeded, produced action #586 and provenance activity #584, and rejected unsafe confirmation paths in automated tests.
- The disposable action was deleted after verification; activity #584 remains as the audit record.
- The live action-update route returned HTTP 500 when asked to close the smoke-test action. This is recorded as `BUG-2026-07-14-ACTION-PATCH-500` in `hub-kernal-product-bug-backlog`; deletion is not an allowed workaround for real actions.
- Gemini tool-call replay now preserves provider thought signatures required by the deployed model.
- Verification passed: 10 focused tests, full workspace typecheck, production web build, and `git diff --check`.
