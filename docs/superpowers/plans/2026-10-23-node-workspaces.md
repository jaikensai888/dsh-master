# Node workspaces implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Each remote node is a sidebar section alongside local workspaces, containing the node's registered workspaces and their sessions, including empty workspaces.

**Architecture:** Extend the existing workspace/follow baseline projection and sessions response, retaining the current coordinator transport. Group sessions by authoritative sessionIds, never cwd. Persist remote node and directory expansion separately from local accounts.

**Tech Stack:** TypeScript, React 18, Vitest, existing CSS module generator.

**Spec:** User-approved hierarchy and behavior in this chat (2026-10-23).

## Global constraints

- No additional dependencies, direct node connections, or profile configuration changes.
- Keep local workspaces, remote navigation, archive actions and five-session overflow.
- Missing workspace support shows a warning and sessions under Ungrouped.
- Stable identities include nodeId and workspaceId; node names and paths are display data.

## Review focus

- Empty registered workspaces remain visible; cwd never determines membership.
- Same workspace/session IDs across nodes never share selection or expansion.
- Invalid or unsupported workspace baselines fail visibly without losing sessions.
- Multiple nodes can expand together and refresh; stale requests cannot overwrite a newer roster.
- Existing persisted v5 preferences migrate without clearing local order or expansion.

### Task 1: Remote data and grouping

Files: src/protocol.ts, src/coordinator/client.ts, src/service.ts, src/workspace/remote-model.ts; test/coordinator-client.test.ts, test/remote-model.test.ts.

- [x] Add failing baseline, validation, authoritative grouping and empty-directory tests; run targeted Vitest tests.
- [x] Add MasterWorkspace and workspaceSnapshot(nodeId, signal) projection; expose workspaces and workspaceError on the sessions response, reusing the same baseline for archives.
- [x] Add groupRemoteWorkspaces(workspaces, sessions), preserving registry order and unassigned sessions; rerun targeted tests.

### Task 2: Per-node sidebar and persistence

Files: src/workspace/RemoteSection.tsx, src/workspace/RemoteSection.module.css, src/workspace/contract/slots.ts, src/workspace/rows/WorkspaceBrowser.tsx, src/workspace/stores.ts, src/workspace/locales.ts; test/remote-section.test.ts, test/workspace-stores.test.ts.

- [x] Add failing rendered hierarchy, empty-directory, isolated expansion and migration tests.
- [x] Render node headers as siblings of the local section; place registered directories and Ungrouped inside each node; allow independent node and workspace expansion.
- [x] Load all expanded online nodes, keep cancellation/stale response guards, and retain collapsed-rail navigation and archive actions.
- [x] Regenerate styles; run targeted tests.

### Task 3: Verification and documentation

- [x] Run typecheck, build, full Vitest suite and generated stylesheet check.
- [x] Review request races, unsupported nodes, persistence migration and sidebar layout; fix verified issues.
- [x] Update README, design notes and docs/log.md with actual behavior and verification boundaries.

Execution ruling: the user explicitly requested implementation of the approved plan; execute inline without another approval step. Reuse the clean current checkout. Leave changes uncommitted for review.

## Verification results (2026-10-23)

- TypeScript application typecheck and declaration build passed; host/client bundles rebuilt.
- Full Vitest suite with DSH_RUNTIME_ROOT set to the installed Desktop runtime: 192 tests passed, 26 files, no skipped tests.
- Generated stylesheet check and git diff whitespace check passed.
- Independent review identified and rechecked fixes for multi-node clipping and valid archive state lost on workspace parse errors.
- Isolated browser fixture uses production React components with synthetic API data and primitive stand-ins. Verified actual workspace paths, empty directories, Ungrouped, independent collapse persistence, five-row overflow, node-scoped selection/archive, legacy-node warning, and narrow-rail node opening.
- Short sidebar test: 18 nodes, 539px client height, 2590px scroll height; last node reached and collapsed at scrollTop 2051.2.
- Archive/refresh race: before fix an archived row reappeared after a slow pre-archive snapshot; after cancelling the stale request and loading a fresh list it stayed hidden after all responses.
- Screenshot: .tmp/node-workspaces-smoke.png; reproducible isolated fixture: .tmp/node-workspaces-preview.mjs (both ignored test artifacts).
- Real Desktop restart and real remote end-to-end communication were not performed. No real prompts were sent, no deployment/profile settings changed.
