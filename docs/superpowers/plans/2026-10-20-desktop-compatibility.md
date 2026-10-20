# Desktop 2.0.18 compatibility

Goal: execute solution 2 selected by the user, preserving the local/remote sidebar.

Target: Desktop 2.0.18, DSH 0.2.1-rc.2. Existing baseline: 159 tests pass.
Work in the current mounted checkout so rebuilding updates the installed plugin.

- [x] Reproduce missing settingsScope/installSection with regression tests. Use configForms and volatile Config fields; preserve credential storage and failed-save behavior.
- [x] Adapt local navigation to retained Session references, null conversation panel selection, workspace opening, fork and archive/restore. Preserve lifecycle cleanup and navigation cancellation.
- [x] Verify the built plugin against the installed client runtime, run typecheck/build/full tests, and review changes.
- [x] Update README/ground truth and append the completed fix to docs/log.md.

Review focus: initialization without old settings services; live URL changes; rejected settings writes; rapid navigation and reference release; local conversation rendering after leaving a remote panel.

No desktop profile edits, migration of user data, remote prompts, or dependency upgrades unrelated to compatibility.

Verification: TypeScript noEmit and declaration build pass; both bundles built; 25 files / 173 tests pass with DSH_RUNTIME_ROOT pointed at the installed runtime. Read-only independent review found selection/cancellation/blank reuse/rename/status gaps; all were reproduced and fixed. UI smoke used an isolated home/profile on loopback port 43128: both sidebar groups, offline coordinator, address save/live use/restart persistence, browse directory picker, workspace creation, blank-session editor, and returning from Plugins to the local session. No prompts were sent.

Runtime changes additionally required 20 renamed icon exports and mapping the current sessionStatus hook. Native directory-picker UI and real remote-node traffic were not exercised; the isolated smoke pinned the shipped browse picker instead. The actual Desktop profile remains untouched.
