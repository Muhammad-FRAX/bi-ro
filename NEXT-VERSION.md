# Next Version — Planned Improvements

Features and fixes queued for the next release. Add items here as they're identified; remove them when implemented.

---

## UI Gaps

### Tag management

Tags display correctly (colored pills, filterable on the servers list) but cannot be created or assigned through the UI. Currently only insertable via direct DB access.

**Required:**

- Create / rename / delete tags (name + color picker) — admin or editor
- Assign / remove tags on a server or app from the server/app detail page (edit form or inline chip editor)
- Ideally reusable across apps and scripts too (those tables already have tag columns in the design)
