# Remote ask_user_question Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a remote session answer DSH `ask_user_question` calls in-place with the structured answer the waiting tool expects.

**Architecture:** `dsh-node` wraps the existing `user-questions/request` waterfall and only publishes a request when existing answerers end in `NO_PROVIDER`. It exposes session-scoped pending/answer/cancel Typert calls. `dsh-master` routes those through the existing coordinator `/api/invoke`, then presents the pending questions in the mounted remote session panel; no synthetic prompt is sent.

**Tech Stack:** TypeScript, Cordis waterfall events, Typert Remotes, coordinator HTTP API, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-remote-ask-user-question.md`

## Global Constraints

- Modify only `dsh-node` and `dsh-master`; do not modify DSH core or `dsh-coordinator`.
- Reuse the coordinator's authenticated `/api/invoke` route; add no coordinator protocol or endpoint.
- Preserve question IDs and return `{ answers: [{ id, selected, custom? }] }` to the original waiting call.
- Scope question reads, answers, and cancellation to the owning `sessionId`; settle each request at most once.
- Preserve ordinary prompt/follow behavior and do not turn an answer into a new prompt.

## Review Focus

- An answer for a different session or stale request must not settle a pending question; test the mismatch and one-shot behavior in the node task.
- Abort during registration and plugin disposal must reject and remove pending requests; test both lifetimes in the node task.
- A node without the new capability must produce a clear compatibility state, not a polling loop; keep the notice visible for the selected session after its tool call settles.
- Malformed question answers must be refused before invocation; test route body validation in the master API task.
- Switching sessions while a poll is in flight must not show the previous session's questions; abort propagation is covered at the browser API and HTTP route boundaries.

---

### Task 1: Node-side question bridge

**Files:**
- Create: `G:/claude_project/code-agent/dsh-node/src/user-questions.ts`
- Modify: `G:/claude_project/code-agent/dsh-node/src/index.ts`
- Test: `G:/claude_project/code-agent/dsh-node/test/integration.test.ts`

**Interfaces:**
- `pending(sessionId)` returns `{ requests: [{ requestId, sessionId, questions }] }` for that session only.
- `answer(sessionId, requestId, answer)` resolves the original waterfall with its structured answer.
- `cancel(sessionId, requestId)` rejects the original waterfall with `UserQuestionError`-compatible `ASK_CANCELLED`.
- The prepended waterfall handler delegates to `next()` first and only bridges terminal `NO_PROVIDER` failures when `request.agent.id` is available.

- [x] **Step 1: Write the failing lifecycle and isolation tests** (`test/integration.test.ts`)

```ts
it('returns a structured answer only through the request owning that session', async () => {
  const bridge = new NodeQuestionBridge()
  const waiting = bridge.ask({ agent: { id: 's1' }, questions: [{ id: 'q1', question: '选择', options: [{ label: 'A' }] }] })
  const request = bridge.pending('s1').requests[0]!
  expect(bridge.pending('s2').requests).toEqual([])
  expect(bridge.answer('s2', request.requestId, { answers: [{ id: 'q1', selected: ['A'] }] })).rejects.toMatchObject({ code: 'nodeQuestions/not-found' })
  bridge.answer('s1', request.requestId, { answers: [{ id: 'q1', selected: ['A'] }] })
  await expect(waiting).resolves.toEqual({ answers: [{ id: 'q1', selected: ['A'] }] })
})
```

- [x] **Step 2: Run focused node bridge tests**

Run: `G:/claude_project/code-agent/dsh-node/node_modules/.bin/vitest.cmd run test/integration.test.ts -t "user-question|local question answerer|pending question"`
Expected: PASS after bridge implementation.

- [x] **Step 3: Implement the bridge and exact three Remote descriptors**

Add one in-memory pending map, project only JSON-safe question fields, validate session/request ownership and answer shape, detach abort listeners at settlement, and reject all remaining requests on disposal. Register a global prepended `user-questions/request` handler that calls `next()` before using the bridge. Install the same owner/descriptors alongside `nodeAdmin/*` during each host boot and retain the pending map across host reconfiguration.

- [x] **Step 4: Run the node tests and type check**

Run: `G:/claude_project/code-agent/dsh-node/node_modules/.bin/vitest.cmd run`
Expected: PASS, including abort, disposal, cross-session refusal, malformed answers, and duplicate settlement.

Run: `G:/claude_project/code-agent/dsh-node/node_modules/.bin/tsc.cmd -p tsconfig.json --noEmit`
Expected: PASS.

### Task 2: Master transport and trusted API

**Files:**
- Modify: `G:/claude_project/code-agent/dsh-master/src/protocol.ts`
- Modify: `G:/claude_project/code-agent/dsh-master/src/coordinator/client.ts`
- Modify: `G:/claude_project/code-agent/dsh-master/src/service.ts`
- Modify: `G:/claude_project/code-agent/dsh-master/src/http-api.ts`
- Test: `G:/claude_project/code-agent/dsh-master/test/coordinator-client.test.ts`
- Test: `G:/claude_project/code-agent/dsh-master/test/http-api.test.ts`

**Interfaces:**
- `GET /dsh-master/api/session/questions?nodeId=…&sessionId=…` returns that session's pending question requests.
- `POST /dsh-master/api/session/question-answer` accepts `{ nodeId, sessionId, requestId, answer }`.
- `POST /dsh-master/api/session/question-cancel` accepts `{ nodeId, sessionId, requestId }`.
- All three master methods invoke `nodeQuestions/{pending|answer|cancel}` using the existing coordinator `/api/invoke` contract.

- [x] **Step 1: Add API and invocation contract tests**

```ts
it('lists only the requested remote session questions through nodeQuestions/pending', async () => {
  const value = await client.pendingQuestions('node-1', 'session-1')
  expect(value).toEqual({ requests: [{ requestId: 'r1', sessionId: 'session-1', questions: [] }] })
  expect(calls[0]?.body).toContain('nodeQuestions/pending')
})
```

- [x] **Step 2: Run focused API and invocation tests**

Run: `G:/claude_project/code-agent/dsh-master/node_modules/.bin/vitest.cmd run test/coordinator-client.test.ts test/http-api.test.ts`
Expected: PASS after implementation.

- [x] **Step 3: Implement node invocation methods and bounded route validation**

Reuse one coordinator invocation helper for the node questions calls. Add response types and the three routes behind the existing trust fence; require non-empty node/session/request IDs and an `answers` array with string IDs/selections before forwarding.

- [x] **Step 4: Run focused tests and master type check**

Run: `G:/claude_project/code-agent/dsh-master/node_modules/.bin/vitest.cmd run test/coordinator-client.test.ts test/http-api.test.ts`
Expected: PASS, including malformed payload refusals and unsupported upstream error preservation.

Run: `G:/claude_project/code-agent/dsh-master/node_modules/.bin/tsc.cmd -p tsconfig.json --noEmit`
Expected: PASS.

### Task 3: Remote session question form

**Files:**
- Modify: `G:/claude_project/code-agent/dsh-master/src/client/api.ts`
- Modify: `G:/claude_project/code-agent/dsh-master/src/client/SessionView.tsx`
- Modify: `G:/claude_project/code-agent/dsh-master/src/client/copy.ts`
- Modify: `G:/claude_project/code-agent/dsh-master/src/client/styles.ts`
- Test: `G:/claude_project/code-agent/dsh-master/test/remote-question.test.ts` and `test/remote-question-api.test.ts`

**Interfaces:**
- Poll only while the current session contains an unresolved `ask_user_question` tool call; abort polling on session change/unmount and stop on an unsupported-node response.
- Submit every question with its original ID and selected option labels/custom text; cancellation calls the cancel route, never `session/prompt`.

- [x] **Step 1: Add rendering and answer-shape tests**

The installed test environment has no DOM renderer. Tests use server-rendered markup plus the pure structured-answer builder, and separately test API submission and request cancellation.

- [x] **Step 2: Run focused question UI/API tests**

Run: `G:/claude_project/code-agent/dsh-master/node_modules/.bin/vitest.cmd run test/remote-question.test.ts test/remote-question-api.test.ts`
Expected: PASS.

- [x] **Step 3: Add a DSH-token-based question card and session-scoped polling**

Render question title/detail/options, single- and multi-select, custom text, multiple questions, answer/cancel busy state, and errors. Keep the UI inside the existing session column, retain the current composer, and map old-node capability errors to a single compatibility notice instead of retrying indefinitely.

- [x] **Step 4: Run UI/API tests, full project suites, and type checks**

Run: `G:/claude_project/code-agent/dsh-master/node_modules/.bin/vitest.cmd run test/remote-question.test.ts test/remote-question-api.test.ts`
Expected: PASS, including custom/multiple answers and abort propagation.

Run: `G:/claude_project/code-agent/dsh-master/node_modules/.bin/vitest.cmd run`
Run: `G:/claude_project/code-agent/dsh-master/node_modules/.bin/tsc.cmd -p tsconfig.json --noEmit`
Expected: all tests and type checks pass; separately run the complete dsh-node suite and type check before handoff.

Verification: dsh-master 21 files / 152 tests and dsh-node 13 files / 473 tests pass; both `tsc --noEmit` and declaration generation plus `tsdown` builds pass. `pnpm build` itself was blocked before reaching the build scripts because its dependency-status wrapper tried to query npm; the same installed build tools were run directly, with no install or network workaround.
