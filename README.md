# Orders Console

A high-performance, minimal order-operations console engineered for customer support and order-taking agents. Built for rapid search across 50,000+ records and guaranteed zero-duplicate phone order registration under concurrent or unstable network conditions.

---

## Architecture Overview

```mermaid
graph TD
    subgraph Browser ["Frontend (React 19 + Vite + TypeScript)"]
        UI["Orders Console UI"]
        AuthCtx["Auth Context (In-Memory JWT)"]
        AbortCtrl["AbortController (Stale Request Cancellation)"]
    end

    subgraph Backend ["API Server (Node.js + Express 5)"]
        AuthMW["requireAuth Middleware (Pinned HS256)"]
        RateLimit["express-rate-limit (Brute-Force Guard)"]
        OrderRoutes["/api/orders (Keyset Pagination & Search)"]
        CreateRoutes["/api/orders [POST] (Idempotency Engine)"]
    end

    subgraph Database ["PostgreSQL 16 (via Prisma ORM)"]
        Users[("users")]
        Orders[("orders (Composite Indexes)")]
        OrderItems[("order_items")]
        Idempotency[("idempotency_records (userId + key UNIQUE)")]
    end

    UI -->|"POST /api/auth/login"| RateLimit --> AuthMW
    UI -->|"GET /api/orders?search=&status=&cursor="| AuthMW --> OrderRoutes
    UI -->|"POST /api/orders (Idempotency-Key)"| AuthMW --> CreateRoutes

    OrderRoutes -->|"Keyset query (limit+1, tiebreaker id)"| Orders
    CreateRoutes -->|"Atomic transaction (P2002 serialization)"| Idempotency
    CreateRoutes -->|"Order + Line items insert"| Orders
    Orders --> OrderItems
    Users --> Orders
```

---

## 5-Minute Quickstart

### Prerequisites
- **Node.js**: v20.x or higher
- **Docker**: For running local PostgreSQL (`docker compose`)
- **Git**

---

### Step 1: Install Dependencies
```bash
npm install
```

---

### Step 2: Environment Configuration
Copy the provided `.env.example` into `apps/api/.env`:

```bash
# On Linux / macOS:
cp .env.example apps/api/.env

# On Windows (PowerShell):
Copy-Item .env.example apps/api/.env
```

Default configuration in `apps/api/.env`:
```env
DATABASE_URL="postgresql://orders_app:local_dev_password@localhost:5433/orders_console?schema=public"
PORT=3000
NODE_ENV=development
JWT_SECRET=replace_with_a_random_secret_of_at_least_32_bytes
JWT_EXPIRES_IN=15m
FRONTEND_URL=http://localhost:5173
```

---

### Step 3: Start PostgreSQL
Launch the isolated PostgreSQL container:
```bash
npm run docker:up
# or: docker compose up -d
```

*(PostgreSQL will listen on port `5433` to prevent conflicts with any local Postgres instances).*

---

### Step 4: Run Database Migrations & Seed
Apply migrations and populate the database with test users and **50,000 realistic orders**:
```bash
npm run db:migrate
npm run db:seed
```

#### Demo Credentials
| Role | Email | Password | Access Level |
|---|---|---|---|
| **Admin** | `admin@orders.test` | `Admin1234!` | Global read & write access |
| **Agent / Manager** | `agent@orders.test` | `Agent1234!` | Full order desk operations |
| **Customer** | `james.smith0@example.test` | `Password123!` | Scoped to own orders only |

---

### Step 5: Start the Development Servers
In two terminal tabs (or separate windows):

```bash
# Tab 1: Start API server (port 3000)
npm run dev:api

# Tab 2: Start Web UI (port 5173)
npm run dev:web
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### Step 6: Run Tests & Verification
Run the complete automated test suite (unit + concurrency integration tests):
```bash
npm test
```

Run end-to-end typechecks across both API and Web workspaces:
```bash
npm run typecheck
```

Build production artifacts for both workspaces:
```bash
npm run build
```

---

## Core Engineering Decisions & Tradeoffs

### 1. Keyset (Cursor-Based) Pagination vs. Offset Pagination
- **Problem**: When querying large datasets ($50,000+$ rows), `OFFSET 45000 LIMIT 20` forces the database engine to scan and discard 45,000 rows. Response times degrade linearly as users navigate deeper into the dataset.
- **Solution**: We implement keyset pagination using `(createdAt, id)` with a stable tiebreaker.
- **Tradeoff**: Random page jumping (e.g., "Jump directly to page 2,400") is not supported; however, sequential page traversal is guaranteed $O(\log N)$ index lookups regardless of table depth.

### 2. Database-Enforced Idempotency vs. In-Memory / Distributed Locks
- **Problem**: Phone agents double-clicking buttons or experiencing mobile/network retries can create duplicate customer charges and order records.
- **Solution**: Every order submission requires a client-generated `Idempotency-Key` header and a canonical SHA-256 hash of the order payload. The key is written inside a Prisma database transaction with a unique database constraint `UNIQUE(userId, key)`.
  - **Identical Retry**: Returns the cached `201 Created` order response instantly without inserting duplicate rows.
  - **Key Conflict with Different Payload**: Returns `422 Unprocessable Entity` ("Idempotency key was reused with a different request").
  - **Concurrent In-Flight Requests**: PostgreSQL row/index lock forces the second request to fail with `P2002` (unique violation), re-fetching and returning the winning response.

### 3. Floating-Point Money Avoidance
- **Problem**: Floating-point math (`0.1 + 0.2 = 0.30000000000000004`) in financial transactions causes rounding bugs, tax mismatches, and data corruption.
- **Solution**: Prices are entered by the user in dollars, translated to whole integer cents on the client, and validated via Zod. The server re-computes `totalAmount` authoritatively using integer sums before casting to Postgres `DECIMAL(12, 2)`. Client totals are discarded.

### 4. In-Memory JWT Authentication vs. LocalStorage
- **Problem**: Storing access tokens in `localStorage` leaves tokens vulnerable to Cross-Site Scripting (XSS) credential exfiltration.
- **Solution**: Tokens are held in JavaScript memory (`React state`). Tokens do not persist across hard reloads, which is an intentional security tradeoff for an internal operations console.
- **Backend Hardening**: JWT verification explicitly pins the algorithm to `HS256` (`{ algorithms: ["HS256"] }`), eliminating algorithm confusion (`none` / RSA public key attacks). Login endpoints are protected by `express-rate-limit` (5 requests / 15 minutes).

### 5. Stale-Response Cancellation (`AbortController`)
- **Problem**: When agents type quickly in the search bar, older search requests may resolve *after* newer requests, causing the UI to display stale, incorrect search results.
- **Solution**: Every request lifecycle binds to an `AbortController`. When search input, status filter, or sorting criteria change, the cleanup function of React's `useEffect` cancels the in-flight HTTP request.
- **Demonstration Hook**: A development-only query parameter `?delay=<ms>` is supported on `GET /api/orders` to simulate slow networks and prove that delayed responses never overwrite fresh user searches.

---

## Live Assessment Walkthrough Guide

Use this script during your live assessment interview to showcase the features:

### 1. Fast Search & Prefix Querying
1. Sign in as `agent@orders.test` with password `Agent1234!`.
2. Notice the live count of seeded orders (50,000 orders).
3. Type `"James"` or an order number like `"ORD-000042"` in the search bar.
4. Explain the debounce mechanism (300 ms) and index-friendly prefix search (avoiding unindexed leading wildcards).

### 2. Safe Phone Order Registration (Idempotency Demo)
1. Click **+ New order**.
2. Enter:
   - Customer Name: `Sarah Connor`
   - Customer Email: `sarah@skynet.test`
   - Item 1: `Mechanical Keyboard`, Quantity `1`, Unit Price `120.00`
   - Item 2: `USB-C Hub`, Quantity `2`, Unit Price `35.00`
3. Click **Submit order**.
4. The server validates line items, authoritatively computes the total ($190.00), inserts both the order and items in a single transaction, and stores the response against the idempotency key.
5. In your network tab or integration test suite (`npm test`), submit the exact same request with the same `Idempotency-Key`:
   - Returns identical `201 Created` with the existing order, without creating a second record.

### 3. Stale Response & Race Condition Proof
1. Open DevTools Network tab and inspect calls to `/api/orders`.
2. Rapidly type several letters into the search input.
3. Observe earlier requests get cancelled (`Status: (canceled)`) via `AbortController`.
4. Point out the dev hook in `orders.routes.ts` (`?delay=2000`) designed to test this behavior under artificial latency.

### 4. Role-Based Access Control
1. Sign in as `admin@orders.test` (`ADMIN` role) → sees all orders.
2. Sign in as `agent@orders.test` (`MANAGER` role) → sees all operational orders.
3. Sign in as customer `james.smith0@example.test` (`CLIENT` role) → order queries are automatically scoped to `where: { userId: authUser.id }`.

---

## Workspace Structure
```
orders-console/
├── apps/
│   ├── api/                       # Express 5 + TypeScript + Prisma ORM
│   │   ├── prisma/
│   │   │   ├── schema.prisma      # PostgreSQL models & indexes
│   │   │   └── seed.ts            # High-performance bulk seed (50,000 orders)
│   │   ├── src/
│   │   │   ├── config/            # Validated environment variables (Zod)
│   │   │   ├── middleware/        # Auth, rate-limiting, error handling
│   │   │   ├── routes/            # Orders query & idempotent creation routes
│   │   │   ├── app.ts             # Express application wiring
│   │   │   └── server.ts          # Server entry point
│   │   └── vitest.config.ts       # Test suite configuration
│   └── web/                       # React 19 + Vite + TypeScript (Vanilla CSS)
│       ├── src/
│       │   ├── AuthContext.tsx    # In-memory JWT authentication provider
│       │   ├── LoginPage.tsx      # Clean operator authentication form
│       │   ├── CreateOrderForm.tsx# Phone order registration with idempotency
│       │   ├── App.tsx            # Main orders table, debounce, pagination
│       │   └── App.css            # Custom responsive design system
├── docker-compose.yml             # Isolated PostgreSQL 16 Alpine
├── package.json                   # Workspace root orchestrator
└── README.md                      # Project documentation & walkthrough
```
