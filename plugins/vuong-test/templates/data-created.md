# Data created — <scope>

Appended by tests with Writes = Y, one row per record, right after the write succeeds.
The tester uses it to delete or revert test data (`node $PLUGIN/core/cleanup-list.mjs data-created.md`).
Status: `left` (still there, removable in the UI) / `needs-be` (cannot be removed in the UI — backend/DB
owner must remove it) / `deleted` / `reverted`.

| Case | When | Environment | Record (key) | Action | How to delete / revert | Status |
|---|---|---|---|---|---|---|
