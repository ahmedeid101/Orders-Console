# DECISIONS.md

This document records the three key architectural trade-offs made while building the Orders Console, weighing chosen solutions against alternatives, followed by disclosure of AI tool usage.

---

### Decision 1: Server-Enforced Idempotency Engine (R2)

- **The Decision**: Every order creation requires a client-generated `Idempotency-Key` header and a canonical sorted-JSON SHA-256 payload hash. Order creation and idempotency records are committed inside a single PostgreSQL transaction backed by a composite unique constraint `UNIQUE(userId, key)`. Concurrent requests with the same key serialize at the database level—the first succeeds with `201 Created` and stores the response body; the second catches the `P2002` unique constraint violation and safely replays the stored response without creating a duplicate record.
- **Alternative Considered**: Distributed caching lock via Redis (e.g., `SETNX` with a TTL) or debouncing solely on the frontend submit button.
- **Why Rejected**: Frontend button debouncing does not protect against mobile network retries, browser page refreshes, or raw API replay. Redis locks introduce an external infrastructure dependency and dual-write race conditions (if Redis commits but the database fails, or if a lock expires before a slow database write finishes, duplicate orders still occur). A PostgreSQL unique constraint is ACID-compliant, zero-dependency, and makes duplicate registration mathematically impossible at the storage layer.

---

### Decision 2: Keyset (Cursor-Based) Pagination over Offset Pagination

- **The Decision**: Implemented keyset pagination using a composite sort key of `(createdAt, id)` with a stable UUID tiebreaker (`take: limit + 1`, utilizing `cursor: { id }`).
- **Alternative Considered**: Traditional SQL offset pagination (`SELECT ... LIMIT 20 OFFSET 45000`).
- **Why Rejected**: On a dataset of 50,000+ orders, `OFFSET 45000` forces the database engine to scan and discard 45,000 index tuples for every query, causing response latency to degrade linearly as agents navigate deeper into the dataset. Furthermore, in an active order desk where phone agents continuously register new orders, offset pagination causes "page drift" where rows shift across pages, leading to duplicate or skipped orders in the UI. Keyset pagination guarantees constant $O(\log N)$ B-tree index lookups regardless of table size.

---

### Decision 3: Native `AbortController` & In-Memory Auth over Heavy State Libraries

- **The Decision**: Managed application state with native React 19 primitives, binding an `AbortController` to the `useEffect` cleanup cycle to cancel in-flight HTTP requests when search inputs or filters change, and keeping the JWT authentication token strictly in JavaScript memory (`AuthContext`).
- **Alternative Considered**: Introducing Redux Toolkit / Zustand with persistent token storage in browser `localStorage`.
- **Why Rejected**: For an operational order console with two screens, external state libraries introduce unnecessary boilerplate, bundle weight, and abstraction layers without real benefit. Storing access tokens in `localStorage` leaves credentials vulnerable to Cross-Site Scripting (XSS) token exfiltration. Native `AbortController` directly and cleanly solves the stale-response race condition with zero external dependencies, ensuring slow delayed network responses never overwrite newer search results.

---

## AI Tools Disclosure

In accordance with Section 5 of the assessment guidelines:
- **What AI Was Used For**: AI assistance was used as a rapid scaffolding and drafting partner: generating realistic names and products for the 50,000-row seed script (`seed.ts`), structuring the initial Docker Compose file, and drafting edge-case test skeletons for concurrent Promise race tests.
- **What Was Done Manually**: All architectural decisions, the database schema and composite indexing strategy, the idempotency transaction serialization logic, the security fixes in the code review, and the performance tuning were reasoned through, verified, and finalized manually.
