# Graph Report - /Users/kishandbelavadi/Downloads/Work/Programming/Open-Apps/pdm  (2026-06-27)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 158 nodes · 239 edges · 11 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3f0248e3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]

## God Nodes (most connected - your core abstractions)
1. `getDb()` - 31 edges
2. `scripts` - 13 edges
3. `createNotification()` - 12 edges
4. `requireAuth()` - 9 edges
5. `SQLiteSessionStore` - 7 edges
6. `logAction()` - 6 edges
7. `initDb()` - 5 edges
8. `requireRole()` - 4 edges
9. `notifySlipSubmitted()` - 4 edges
10. `notifyInvoiceCreated()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `getUnreadCount()` --calls--> `getDb()`  [EXTRACTED]
  routes/admin.js → database/schema.js
- `getApprovedSlipsNotInvoiced()` --calls--> `getDb()`  [EXTRACTED]
  routes/invoices.js → database/schema.js
- `getInvoiceSlips()` --calls--> `getDb()`  [EXTRACTED]
  routes/invoices.js → database/schema.js
- `recalcInvoice()` --calls--> `getDb()`  [EXTRACTED]
  routes/invoices.js → database/schema.js
- `updateInvoiceSlipStatus()` --calls--> `getDb()`  [EXTRACTED]
  routes/invoices.js → database/schema.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **PDM Persistence Layer** — docker_compose_pdm_data_volume, docker_compose_pdm_uploads_volume, docker_compose_pdm_logs_volume [INFERRED 0.90]

## Communities (11 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (24): loadUserPermissions(), requireAuth(), requireRole(), express, { getDb }, { requireAuth }, router, express (+16 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (23): express, { getDb }, { logAction }, multer, { notifySlipSubmitted, notifySlipApproved, notifySlipRejected, notifySlipChangesRequested, notifySlipNonBillable }, path, { requireAuth, requireRole }, router (+15 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (15): getDb(), { getDb }, SQLiteSessionStore, { exportSlipsToPDF, exportSlipsToExcel, exportSlipsToCSV, exportInvoicesToExcel }, express, { getDb }, { requireAuth }, router (+7 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (15): createAuditLog(), logAction(), bcrypt, express, { getDb }, getUnreadCount(), { logAction }, { notifyUserCreated, notifyRoleUpdated } (+7 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (17): description, name, private, scripts, dev, docker:build, docker:down, docker:logs (+9 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (13): dependencies, bcryptjs, chart.js, ejs, exceljs, express, express-session, json2csv (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.24
Nodes (8): { DatabaseSync }, DB_PATH, initDb(), path, wrap(), bcrypt, { initDb, getDb }, seed()

### Community 7 - "Community 7"
Cohesion: 0.18
Nodes (10): express, getApprovedSlipsNotInvoiced(), { getDb }, getInvoiceSlips(), { logAction }, { notifyInvoiceCreated, notifyInvoiceReconciled, notifyInvoicePaid }, recalcInvoice(), { requireAuth, requireRole } (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.40
Nodes (5): PDM Data Volume, PDM Logs Volume, PDM Service, PDM Uploads Volume, Session Secret Environment Variable

## Knowledge Gaps
- **97 isolated node(s):** `{ getDb }`, `name`, `version`, `private`, `description` (+92 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getDb()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 6`, `Community 7`?**
  _High betweenness centrality (0.208) - this node is a cross-community bridge._
- **Why does `requireAuth()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 7`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **What connects `{ getDb }`, `name`, `version` to the rest of the system?**
  _97 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07586206896551724 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.13768115942028986 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.12280701754385964 - nodes in this community are weakly interconnected._