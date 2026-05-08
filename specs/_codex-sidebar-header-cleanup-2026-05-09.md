# Sidebar Header Cleanup

Date: 2026-05-09

## Target

- Remove the refresh and collapse buttons from the left task-list header.
- Keep the New Chat command as the only header action in the Recent Chats rail.
- Preserve sidebar collapse through the workspace command dock, which is now the canonical layout-control location.
- Delete stale refs, event handlers, and CSS/test expectations for the removed sidebar header buttons.

## Checklist

- [x] Remove static refresh/collapse button markup.
- [x] Remove imperative handlers and DOM refs for the deleted buttons.
- [x] Delete sidebar toolset styles tied to those buttons.
- [x] Update tests to assert the old controls are absent and the New Chat action remains.
- [x] Verify with targeted tests, typecheck, build, commit, and push.
