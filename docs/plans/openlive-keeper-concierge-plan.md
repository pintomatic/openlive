# OpenLive Keeper Concierge Plan

Status: final plan after CRITICON; ready for implementation approval.

Working codename: Moneypenny. This is an internal codename only. No public naming decision is included.

Planning date: 2026-08-01.

Planning baselines inspected:

- `openlive` at `4e9d2bf` on `blekkie/aws-mobile-voice`;
- `kernal-full` at local `0b66bf5` on `main`, with the implementation required to refresh against origin before editing;
- Keeper Control Plane live contract from ADR-010 and manual page 29;
- existing OpenLive fleet, recall, two-turn keeper-action and provenance implementation.

This plan changes no production system. The existing dirty worktrees and unrelated untracked files are explicitly outside scope.

## 1. Executive decision

Build a small Keeper Concierge inside OpenLive and Kernal.

Do not build an autonomous dispatcher, a cloud-agent launcher, another keeper, or another task-management product.

The feature should let Cesar speak naturally without knowing keeper IDs:

> "Capture this idea about evaluation receipts."

> "Queue the compliance dashboard ordering problem."

> "Remind me next Thursday to decide whether we publish the explorer."

> "The Falsify report is accurate but too defensive for the meeting."

OpenLive turns the utterance into a reversible intake item, resolves its context, suggests the responsible keeper, and follows the item through acknowledgement, clarification, promotion or completion. It does not execute the requested work by default.

The product rule is:

> Capture immediately when intent is explicit. Promote deliberately. Execute separately.

## 2. Product boundary

### 2.1 What this is

The Keeper Concierge is a trusted internal intake and handoff surface over the existing Keeper Control Plane.

It provides:

- low-friction voice and text capture;
- context resolution against Kernal;
- deterministic keeper-owner suggestions;
- a structured keeper inbox;
- acknowledgement, clarification, defer, transfer and completion states;
- safe promotion of reviewed work requests or reminders into existing Kernal actions;
- status and follow-up through OpenLive;
- append-only provenance for every routing and state transition.

### 2.2 What this is not

The MVP does not:

- launch Claude, Codex or any ephemeral agent;
- execute code or modify repositories;
- mutate production systems;
- send email, messages or calendar invitations;
- publish content;
- alter keeper identity, authority or branch ownership;
- write another keeper's branch state;
- turn every spoken thought into canonical memory;
- claim proactive mobile push notifications;
- support event-triggered reminders such as "after legal review" unless a concrete due date is also supplied;
- inject messages into arbitrary already-running Claude or Codex chats.

Execution may become a later independently approved adapter. It is deliberately excluded from the first product.

## 3. Current assets

The MVP is viable because most of the hard governance already exists.

### Kernal

- typed Keeper Registry and fleet projection;
- keeper-bound principals with `keeper:operate`;
- environment isolation;
- active writer-mode enforcement;
- optimistic concurrency on branch state;
- append-only keeper heartbeats;
- standard non-secret API errors;
- actions, activities, entities, search and provenance;
- generated managed-HUB projection.

### OpenLive

- authenticated single-user mobile voice surface;
- typed `/api/keepers/fleet` consumption;
- bounded Kernal recall;
- existing server-only Kernal client;
- two-turn confirmed keeper-action writes;
- proposal replay, expiry and duplicate protection;
- provenance activities;
- visible tool status in the voice transcript;
- resilient voice operation when Kernal is unavailable.

### Keeper harness

- keeper-wake identity resolution;
- bound credential retrieval;
- structured branch-state reconciliation;
- idempotent heartbeat;
- canonical HUB and fleet awareness.

## 4. Primary user journeys

### 4.1 Explicit concept capture

User:

> "Capture this thought: the external receipt should prove integrity, while Kernal owns the decision lifecycle."

System behavior:

1. Treat `capture this thought` as explicit write intent.
2. Normalize the content without changing its meaning.
3. Resolve `external receipt`, `Kernal` and nearby active context.
4. Preview routing internally.
5. Create one staged `idea` intake item idempotently.
6. Suggest one primary keeper and optional observers.
7. Read back a short receipt with an undo option.
8. Do not create a memory, action, HUB update or agent run.

Expected reply:

> "Captured under the Falsify evidence work. Release Proof is the suggested owner; Messaging is an observer. Nothing was executed."

### 4.2 Work request

User:

> "Queue the compliance panel so applicable obligations appear first."

System behavior:

1. Create a `work_request` intake item.
2. Resolve the compliance dashboard and EU AI Act cartridge context.
3. Suggest the product/code keeper without requiring its name.
4. Place it in that keeper's inbox as `routed`, not `accepted`.
5. The keeper later accepts, asks for clarification, defers, transfers or rejects it.
6. No implementation starts automatically.

### 4.3 Reminder

User:

> "Remind me next Thursday to decide whether we publish the EU AI Act explorer."

System behavior:

1. Resolve the date in `Europe/Oslo` and read back the absolute date.
2. Create a staged `reminder` intake item with `due_at`.
3. Link the explorer, legal/content gate and relevant keeper context.
4. Surface due reminders at the start of a later OpenLive session and through the status tool.
5. Do not claim operating-system or mobile push notification delivery in the MVP.
6. A keeper or Cesar may promote the reviewed reminder to a normal Kernal action.

### 4.4 Candidate decision

User:

> "Record that we should not make Falsify a dependency until the receipt contract is fixed."

System behavior:

1. Create a `decision_candidate`, not a canonical decision.
2. Route it to the branch that owns the evidence and partnership boundary.
3. Require keeper review before promotion into a decision, ADR or HUB.
4. Preserve the original wording and the normalized summary.

### 4.5 Feedback

User:

> "The partnership report is technically right but too defensive for the meeting."

System behavior:

1. Resolve the report artifact and current partnership context.
2. Create a `feedback` item.
3. Route one primary owner and optional observer.
4. Preserve the feedback as an intake record until the owner acknowledges it.

### 4.6 Status and follow-up

User:

> "What happened to the things I captured this week?"

Expected response:

- captured count;
- routed count;
- accepted, deferred and clarification counts;
- completed items with evidence links;
- overdue reminders;
- items needing Cesar;
- unrouted or stale items;
- explicit statement that no autonomous execution occurred.

## 5. Canonical architecture

```text
iPhone / OpenLive voice
          |
          | final text + explicit user intent
          v
OpenLive Keeper Concierge tools
          |
          | route preview, capture, cancel, status
          v
Kernal Keeper Intake API
          |
          +--> deterministic context and owner resolver
          |        |
          |        +--> keeper routing profiles
          |        +--> fleet and branch state
          |        +--> child HUBs and bounded search evidence
          |
          +--> keeper_intake_items current projection
          +--> keeper_intake_events append-only history
          |
          v
Owning keeper inbox --> accept / clarify / defer / transfer / complete
          |
          +--> optional reviewed promotion to existing Kernal action
          |
          v
OpenLive status and follow-up
```

Kernal owns the structured intake and state machine. OpenLive remains a surface. Keepers remain the branch authorities.

## 6. Source-of-truth model

| Concern | Canonical authority |
|---|---|
| Keeper identity and authority | Existing Keeper Registry and authority events |
| Keeper operational state | Existing keeper branch state |
| Routing vocabulary and owned surfaces | New versioned keeper routing profile |
| Intake current state | `keeper_intake_items` |
| Intake history and provenance | Append-only `keeper_intake_events` |
| Durable promoted work | Existing Kernal action or other reviewed target record |
| Voice presentation | OpenLive only; never canonical |

The intake table is a staging layer. It must not become a competing memory graph, action system or branch state.

## 7. Proposed data contracts

### 7.1 `keeper_routing_profiles`

One versioned operational routing profile per active keeper.

Fields:

- `keeper_id`;
- `profile_version`;
- `owned_surface_refs_json`;
- `repository_refs_json`;
- `system_refs_json`;
- `project_hub_refs_json`;
- `positive_terms_json`;
- `negative_terms_json`;
- `fallback_priority`;
- `updated_at`;
- `updated_by`.

Rules:

- profile changes require registrar authority or a reviewed keeper proposal;
- the profile cannot change keeper identity or branch ownership;
- stale or missing profiles produce warnings, not invented ownership;
- routing terms are bounded and inspectable;
- a deterministic validator reports collisions between keepers.

### 7.2 `keeper_intake_items`

Current projection of one captured item.

Fields:

- `id`;
- `contract_version`;
- `kind`: `idea`, `work_request`, `reminder`, `decision_candidate`, `feedback`;
- `capture_text`: bounded normalized content;
- `verbatim_text`: optional explicit user wording, never audio;
- `status`: `captured`, `routed`, `needs_clarification`, `accepted`, `deferred`, `promoted`, `completed`, `rejected`, `cancelled`;
- `suggested_keeper_id`;
- `assigned_keeper_id`;
- `observer_keeper_ids_json`;
- `route_confidence`;
- `route_reason_codes_json`;
- `context_refs_json`;
- `due_at`;
- `promotion_type` and `promotion_id`;
- `created_by_subject_type` and `created_by_subject_id`;
- `requested_by_actor`, server-attested from the authenticated OpenLive session;
- `source_surface`;
- `correlation_id`;
- `idempotency_key`;
- `state_version`;
- `created_at`, `updated_at`, `completed_at`.

Constraints:

- capture text is required and bounded;
- no audio, API key, full conversation or screenshot is stored;
- optional `verbatim_text` means the user-approved final text turn, not audio, partial ASR hypotheses or hidden conversation context;
- `assigned_keeper_id` is nullable until accepted;
- a routing suggestion is not authority;
- state transitions use optimistic concurrency;
- promotion links are additive and unique;
- cancellation and rejection preserve history;
- no destructive delete route exists in the MVP.

### 7.3 `keeper_intake_events`

Append-only history.

Fields:

- `id`;
- `intake_id`;
- `event_kind`;
- `from_status` and `to_status`;
- `actor_subject_type` and `actor_subject_id`;
- bounded `reason`;
- `route_snapshot_json`;
- `context_snapshot_json`;
- `state_version`;
- `created_at`.

Every accepted, transferred, clarified, deferred, promoted, completed, rejected or cancelled transition records one event in the same transaction as the projection update.

## 8. Routing model

Keeper inference must be useful without becoming an opaque authority mechanism.

### 8.1 Inputs

- explicit project, repository, system or person references;
- currently selected or recently discussed OpenLive context;
- bounded Kernal search results;
- keeper routing profiles;
- active fleet and child HUB ownership;
- current branch work and next action;
- intake kind.

### 8.2 Deterministic scoring order

1. Exact owned surface, repository, system or child-HUB match.
2. Exact project/entity reference linked to one owned surface.
3. Positive and negative routing terms.
4. Current branch-state overlap.
5. Bounded lexical overlap against keeper display name and branch URI.

The OpenLive model may propose structured entities and an intake kind. It may not assign authoritative ownership. Kernal recomputes the route from inspectable inputs.

Search snippets and HUB text are untrusted evidence. They may contribute bounded lexical references but cannot alter routing profiles, thresholds, authority, environment, tools or transition policy.

### 8.3 Confidence behavior

- High confidence and clear margin: create as `routed` with a suggested keeper.
- Medium confidence: create as `needs_clarification` and ask a domain question.
- Low confidence or collision: keep `captured` and place it in the operator triage view.
- No active keeper match: never invent a keeper or default silently.

Clarification questions use subject language rather than keeper names:

> "Is this mainly about proving the mechanism, or how we present it externally?"

### 8.4 Assignment and transfer

- A suggested keeper becomes assigned only when the bound keeper accepts it.
- A keeper can decline and suggest another owner with a reason.
- Transfer does not write the target keeper's branch state.
- The target receives a pending transfer and must accept it.
- Observer notifications are read-only and do not create duplicate work items.

## 9. Write and confirmation policy

### 9.1 Single-turn staged capture

A staged intake write is allowed in the same turn only when the user uses an explicit imperative such as:

- capture this;
- note this;
- queue this;
- remind me;
- record this feedback;
- add this to the inbox.

The item is reversible, cannot execute work and cannot mutate a canonical branch record. OpenLive reads back the short result and offers cancellation.

### 9.2 Implicit conversational thoughts

OpenLive must not silently harvest ordinary conversation. If the user expresses a thought without explicit capture language, OpenLive asks one short question before writing:

> "Worth capturing for the compliance work?"

### 9.3 Higher-impact promotion

Promotion to an action, decision, memory, HUB, external message or execution remains separately governed.

MVP automatic promotion supports only:

- reviewed `work_request` to an existing Kernal action;
- reviewed dated `reminder` to an existing Kernal action.

Ideas, candidate decisions and feedback require a keeper-controlled existing write path. No generic "promote anything" endpoint is allowed.

## 10. REST surface

### Read and preview

```text
POST /api/keeper-intake/route-preview
GET  /api/keeper-intake/:intake_id
GET  /api/keeper-intake?created_by=surface.openlive.voice
GET  /api/keepers/:keeper_id/inbox
GET  /api/keeper-intake/summary
```

`route-preview` performs zero writes. All GET endpoints perform zero writes.

### Capture and owner operations

```text
POST /api/keeper-intake
POST /api/keeper-intake/:intake_id/cancel
POST /api/keeper-intake/:intake_id/accept
POST /api/keeper-intake/:intake_id/clarify
POST /api/keeper-intake/:intake_id/defer
POST /api/keeper-intake/:intake_id/transfer
POST /api/keeper-intake/:intake_id/reject
POST /api/keeper-intake/:intake_id/complete
POST /api/keeper-intake/:intake_id/promote-action
```

Every write requires:

- active writer mode;
- environment assertion;
- typed API principal;
- idempotency key where a retry could duplicate state;
- `If-Match` on state transitions;
- bounded validated payload;
- standard non-secret error envelope;
- append-only event provenance.

### Stable error codes

- `keeper_intake_disabled`;
- `keeper_intake_not_found`;
- `keeper_intake_identity_mismatch`;
- `keeper_intake_transition_invalid`;
- `keeper_intake_version_conflict`;
- `keeper_intake_route_ambiguous`;
- `keeper_intake_route_collision`;
- `keeper_intake_owner_inactive`;
- `keeper_intake_promotion_not_allowed`;
- `keeper_intake_promotion_already_exists`;
- `idempotency_key_required`;
- existing `validation_failed`, `writer_mode_blocked`, `environment_forbidden` and `internal_error` envelopes.

## 11. Authority model

### OpenLive service principal

The production feature requires a dedicated principal bound as:

- `subject_type = service`;
- `subject_id = surface.openlive.voice`;
- ordinary `read` plus narrowly defined intake scopes;
- no keeper identity and no registrar authority.

Do not extend or reuse a broad shared Blekkie key for intake writes. Credential creation and rollout follow the existing every-copy, no-log and authenticated-serving verification discipline.

May:

- preview routing;
- create bounded intake items attributed to `surface.openlive.voice`;
- read and cancel intake items it created;
- read summary/status needed to answer Cesar.

May not:

- accept on behalf of a keeper;
- assign authority;
- mutate keeper branch state;
- promote candidate decisions or memories;
- execute work;
- mutate registry or routing profiles;
- access another environment.

### Keeper principal

May:

- read its own inbox;
- accept, clarify, defer, reject or complete items assigned or proposed to it;
- propose a transfer;
- promote eligible reviewed work requests or dated reminders to actions;
- attach non-secret completion evidence.

May not:

- write another keeper's branch;
- force a transfer acceptance;
- change routing profiles directly unless separately delegated;
- modify intake history;
- reinterpret an idea as a canonical decision without the correct existing authority path.

### Registrar/operator

May:

- maintain routing profiles;
- resolve owner collisions;
- inspect unrouted items;
- cancel malformed or abusive intake;
- never silently alter the user's captured meaning.

## 12. OpenLive changes

### Tools

Add:

- `keeper_intake_capture`: capture one explicit staged item without requiring a keeper ID;
- `keeper_intake_cancel`: cancel one recent OpenLive-created item;
- `keeper_intake_status`: summarize recent captures, due reminders and items requiring Cesar;
- `keeper_intake_route_preview`: internal diagnostic/clarification tool, not normally narrated in detail.

Retain:

- `keeper_status` for fleet state;
- `kernal_recall` for facts;
- the existing confirmed action tools during migration.

Do not silently dual-write an intake item and an action. The action path remains explicit until reviewed promotion is live.

### Prompt contract

The voice model must:

- infer the subject, never require a keeper name;
- use explicit capture language as write intent;
- ask before capturing ordinary conversation;
- state that an item was queued, not executed;
- avoid reading internal keeper IDs unless requested;
- state uncertainty when routing needs clarification;
- never claim mobile push delivery;
- never invent completion or acceptance;
- retrieve fresh status before reporting progress.

### Voice receipt

Keep the acknowledgement short:

> "Captured for the compliance product work. It is queued, not running."

Do not narrate proposal IDs, confidence decimals, API errors or internal branch names unless diagnosis is requested.

## 13. Keeper-wake transition

Extend the installed keeper-wake helper so every wake reads:

- newly routed items;
- pending transfers;
- clarification responses;
- overdue accepted items;
- items requiring completion evidence.

The wake report remains bounded. Intake is shown before reconciliation but does not automatically change branch state.

Example:

```text
INBOX
2 new work requests
1 feedback item
1 request needs clarification
0 forced branch-state changes
```

Existing keeper credentials are reused through the helper. No new key-copying workflow is introduced.

## 14. Reminder boundary

MVP reminders are durable dated records, not a notification service.

They are surfaced:

- on the next OpenLive session after `due_at`;
- when Cesar asks for reminders or intake status;
- in the responsible keeper's inbox;
- after reviewed promotion to a Kernal action, through existing action views.

Mobile push, SMS, Telegram, email and calendar delivery are separately scoped integrations. The first release must not imply those channels exist.

Relative dates are normalized to ISO timestamps using `Europe/Oslo` and read back as an absolute date before acknowledgement.

## 15. Feature flags and rollout

### Kernal

- `KERNAL_KEEPER_INTAKE=1`;
- `KERNAL_KEEPER_INTAKE_ENV=blekkie`;
- `KERNAL_KEEPER_INTAKE_WRITES=1`;
- `KERNAL_KEEPER_INTAKE_PROMOTION=1` separately enables eligible action promotion.

### OpenLive

- `OPENLIVE_KEEPER_INTAKE_READ_ENABLED=1`;
- `OPENLIVE_KEEPER_INTAKE_WRITE_ENABLED=1`;
- `OPENLIVE_KEEPER_INTAKE_STATUS_ON_START=1` separately controls due-item briefing.

Flag-off behavior must match current OpenLive and Keeper Control Plane behavior exactly.

### Voice latency budget

| Operation | Budget | Failure behavior |
|---|---:|---|
| Cached intake summary | under 50 ms | Return cached timestamp |
| Fresh route preview | 1.5 s aggregate | Capture as unrouted or ask later; never guess |
| Intake capture | 3 s aggregate | Report uncertain result and read back by correlation ID; never retry blindly |
| Status refresh | 2.5 s aggregate | Use labelled stale cache or report unavailable |
| Session-start due check | background after ready | Must not delay voice readiness or prompt warming |

Kernal intake is not queried on every utterance. Only explicit capture, status, reminder and clarification turns invoke it.

## 16. Verification plan

### Schema and state machine

- additive, idempotent migration;
- every allowed transition and every forbidden transition;
- append-only event parity with projection state;
- no destructive delete;
- promotion uniqueness;
- partial failure rollback;
- repeated migration and partial-resume behavior.

### Authority and isolation

- OpenLive cannot accept as a keeper;
- keeper A cannot read or mutate keeper B's private inbox item;
- transfer requires target acceptance;
- inactive keeper cannot accept;
- shared tenant key cannot claim keeper identity;
- the OpenLive service principal cannot claim keeper identity or call registrar routes;
- cross-environment access denied;
- passive/warmup writer blocked;
- key rotation preserves subject binding;
- errors reveal no secret or unrelated intake content.

### Idempotency and concurrency

- repeated voice delivery creates one intake item;
- concurrent accept attempts produce one success and one `409`;
- cancel/accept race produces one valid terminal path;
- repeated action promotion creates exactly one action;
- GET and route-preview create zero writes.

### Routing benchmark

Create a frozen human-labelled internal benchmark using the active keeper fleet:

- direct repository and system references;
- concepts spanning product, release proof, messaging, commercial and personal branches;
- ambiguous cross-branch cases;
- explicit negative-space examples;
- inactive or nonexistent owner cases;
- Norwegian names and speech-to-text variants.

Ship gates:

- 100% exact-surface routes correct;
- no inactive or nonexistent keeper selected;
- no ambiguous benchmark item auto-assigned;
- all low-confidence cases enter clarification or triage;
- routing explanation contains only inspectable reason codes;
- model-suggested owner cannot override the deterministic result.

### OpenLive

- explicit capture writes once;
- casual conversation writes nothing;
- acknowledgement says queued, not running;
- cancel works after acknowledgement;
- route ambiguity produces a domain question;
- status reads fresh state and identifies anything requiring Cesar;
- Kernal outage leaves ordinary voice usable;
- no raw transcript, audio, image, API key or full conversation stored;
- prompt-injected graph content cannot change authority or capture policy.

### Repository checks

- `kernal-full`: capped build, full tests with maxWorkers=4, ADR-005 guard, generated-doc drift and repository audit;
- `openlive`: focused agent tests, workspace typecheck and production web build;
- secret scan and `git diff --check` in both repositories;
- preserve unrelated dirty and untracked files.

## 17. Delivery slices

### Slice 0: contracts and ADR

- ADR for staged keeper intake;
- Zod/DTO contracts;
- state transition table;
- error catalog;
- routing benchmark fixture;
- feature-flag contract.

### Slice 1: Kernal intake substrate

- additive tables and indexes;
- service and route layer;
- authorization, idempotency and optimistic concurrency;
- append-only events;
- zero-write reads and route preview.

### Slice 2: deterministic routing

- routing profiles;
- profile collision validator;
- context-reference resolver;
- deterministic scorer and confidence behavior;
- human-labelled benchmark.

### Slice 3: OpenLive Concierge

- server-only client methods;
- capture, cancel and status tools;
- prompt contract;
- short voice acknowledgements;
- no-keeper-name user flow;
- focused replay, ambiguity and outage tests.

### Slice 4: keeper inbox

- keeper-wake read integration;
- accept, clarify, defer, transfer, reject and complete operations;
- reviewed action promotion for work requests and dated reminders;
- completion evidence readback.

### Slice 5: documentation and proof

- generated REST catalog;
- Kernal manual and OpenLive architecture update;
- proof pack;
- Fable verification packet;
- HUB updates through the Keeper Control Plane;
- exact rollback commands.

### Slice 6: guarded delivery

1. Deploy Kernal with all new flags off.
2. Verify flag-off parity and ground truth.
3. Enable read/preview only in `blekkie`.
4. Run the frozen routing benchmark against live read state.
5. Enable intake writes for authenticated OpenLive only.
6. Capture one labelled idea, work request, reminder and ambiguous item.
7. Wake one keeper and prove inbox receipt without branch-state mutation.
8. Accept and complete one disposable work request.
9. Enable promotion only after the base loop passes.
10. Promote one disposable reviewed action and prove replay protection.

Production mutation requires explicit approval at the rollout and write gates.

## 18. Rollback

- Disable `OPENLIVE_KEEPER_INTAKE_WRITE_ENABLED` to stop new voice captures while retaining status reads.
- Disable `KERNAL_KEEPER_INTAKE_WRITES` to stop all intake mutations.
- Disable the entire Kernal feature while leaving existing Keeper Control Plane and OpenLive action behavior unchanged.
- Roll back OpenLive and Kernal images through their existing guarded mechanisms.
- Preserve created intake and event rows for audit. Do not delete them automatically.
- Cancel disposable proof items through the normal state transition.
- Promotion rollback closes or corrects the disposable action through the existing action lifecycle; it never deletes unrelated records.

## 19. Acceptance criteria

The MVP is shippable when:

- Cesar can capture an idea, queue work, record feedback and create a dated reminder without naming a keeper;
- explicit capture creates one staged item, while ordinary conversation creates none;
- deterministic routing selects the correct owner for exact owned surfaces and refuses ambiguous assignment;
- no intake item executes work;
- the suggested keeper must accept before becoming assigned;
- keeper-wake shows new inbox items without changing branch state;
- OpenLive can report what happened to recent captures with current evidence;
- cancellation, clarification, defer, transfer, completion and action promotion are audited and replay-safe;
- reminders are described honestly as durable due items, not push notifications;
- no raw audio, full transcript, secret or customer data leaks into intake records;
- flag-off behavior remains unchanged;
- both repositories are CI-green and independently reviewable;
- one live voice-to-inbox-to-completion proof passes under explicit production approval.

## 20. CRITICON review

### Original direction

The initial concept was a phone-based dispatcher that could launch ephemeral Claude or Codex workers and report their status.

### Verdict

Reject autonomous dispatch for the first release. Approve a staged Keeper Concierge after the corrections below.

### Findings absorbed

1. **Execution exceeded the trust requirement.** The real user need is capture, routing and follow-up. All agent launching and autonomous execution were removed from the MVP.
2. **Requiring keeper names failed the user experience.** Routing now derives from owned surfaces and context. Ambiguity produces a domain question, never an organization-chart question.
3. **An LLM-selected keeper would create false authority.** The OpenLive model may extract structured hints, but Kernal deterministically recomputes owner suggestions from inspectable routing profiles and graph references.
4. **Direct routing could contaminate another branch.** A route is a suggestion. The keeper becomes assigned only after accepting. Transfer requires target acceptance and never writes branch state.
5. **Reusing actions would turn every thought into work.** A separate staging projection and append-only event log preserve ideas and feedback without polluting actions or memories.
6. **Zero-friction capture risked ambient surveillance.** Same-turn write is allowed only after explicit capture language. Ordinary conversation requires a question before storage.
7. **Two-turn confirmation for every note would make voice capture tedious.** Explicit commands can create reversible staging records in one turn; higher-impact promotion retains stronger review.
8. **"Remind me" could overpromise notifications.** MVP reminders surface in OpenLive and keeper inboxes. Mobile push and event-triggered reminders are explicitly excluded.
9. **Existing chat windows cannot receive magical live injections.** Durable keeper inbox delivery is the contract. Active-session polling or push is a later adapter.
10. **A central intake queue could become another source of truth.** Intake is staging only. Keeper state, actions, memories, decisions and HUBs remain canonical in their existing domains.
11. **Routing profiles can rot or collide.** Profiles are versioned, validator-audited and registrar-controlled. Missing or ambiguous ownership fails into clarification or triage.
12. **Voice retries could duplicate work.** Capture and promotion require idempotency; state transitions require `If-Match`; the event and projection update are transactional.
13. **Full transcript storage would expand the privacy boundary.** Only bounded captured content and explicit optional verbatim wording are stored. No audio, full conversation, images or hidden prompt context.
14. **A public "Moneypenny" name could create trademark and positioning issues.** It remains an internal codename. Public naming is outside scope.
15. **A new application would duplicate OpenLive.** OpenLive is the mobile/voice surface, Kernal is the control plane, and the keeper harness consumes the inbox. No fourth product is introduced.
16. **A broad OpenLive key would inherit excessive authority.** The production gate now requires a dedicated service-bound principal with narrow intake scopes and no keeper or registrar authority.
17. **Automatic inbox checks could damage the voice experience.** Due-item briefing runs after readiness, route and status calls have aggregate deadlines, and failure never blocks ordinary conversation.

### CRITICON conclusion

The corrected plan is a coherent product slice rather than an agent-platform project. It creates value immediately without asking Cesar to trust autonomous execution.

## 21. Effort estimate

### Shippable MVP

| Work | Focused engineering time |
|---|---:|
| Contracts, ADR, schema and state machine | 0.5-0.75 day |
| Kernal routes, auth, events and tests | 1.0-1.5 days |
| Deterministic routing profiles, validator and benchmark | 0.75-1.0 day |
| OpenLive tools, prompt and tests | 0.75-1.0 day |
| Keeper-wake inbox and reviewed action promotion | 0.5-0.75 day |
| Docs, proof, guarded rollout and live voice verification | 0.5-0.75 day |
| **Total** | **4-6 focused engineering days** |

With uninterrupted Codex execution, existing test infrastructure and no unexpected live-data defect, this is realistically one concentrated implementation goal across several bounded slices, not a multiweek build.

### What would make it multiweek

- native iOS/Android push notifications;
- event-triggered reminders from arbitrary graph changes;
- automatic Claude/Codex cloud execution;
- multi-user identity and household/team permissions;
- external messaging or calendar delivery;
- generalized promotion into every Kernal record type;
- a public multi-tenant product UI.

Those are excluded.

## 22. Approval decision

Recommended approval:

> Approve the 4-6 day Keeper Concierge MVP through repo-first implementation and dry-run proof. Keep production rollout, first live intake writes and action-promotion proof as explicit gates.

If queued rather than approved now, this document is sufficient to restart without redesign. Before implementation, refresh both repositories against their canonical remotes, re-audit dirty worktrees and confirm the live Keeper Control Plane contract has not drifted.
