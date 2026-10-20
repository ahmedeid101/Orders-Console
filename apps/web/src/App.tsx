import { useEffect, useState } from "react";
import "./App.css";

type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED";

type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalAmount: string | number;
  createdAt: string;
};

type OrdersResponse = {
  data: Order[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

const PAGE_SIZE = 10;

const statuses: Array<"ALL" | OrderStatus> = [
  "ALL",
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "COMPLETED",
  "CANCELLED",
];

const formatMoney = (amount: string | number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount));

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));

function App() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | OrderStatus>("ALL");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce typing to avoid sending a request for every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [search]);

  // Reset pagination when filters or sorting change.
  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
  }, [debouncedSearch, status, sortBy, sortOrder]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadOrders() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        sortBy,
        sortOrder,
      });

      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }

      if (status !== "ALL") {
        params.set("status", status);
      }

      if (cursor) {
        params.set("cursor", cursor);
      }

      try {
        const response = await fetch(
          `${API_URL}/orders?${params.toString()}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(
            body?.error?.message ??
              `Failed to load orders (${response.status})`,
          );
        }

        const result: OrdersResponse = await response.json();

        if (!controller.signal.aborted) {
          setOrders(result.data);
          setHasMore(result.pagination.hasMore);
          setNextCursor(result.pagination.nextCursor);
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.name !== "AbortError" &&
          !controller.signal.aborted
        ) {
          setError(err.message);
          setOrders([]);
          setHasMore(false);
          setNextCursor(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadOrders();

    return () => controller.abort();
  }, [debouncedSearch, status, sortBy, sortOrder, cursor]);

  function goToNextPage() {
    if (!nextCursor || !hasMore || loading) return;

    setCursorHistory((history) => [...history, nextCursor]);
    setCursor(nextCursor);
  }

  function goToPreviousPage() {
    if (cursorHistory.length === 0 || loading) return;

    const previousHistory = cursorHistory.slice(0, -1);
    const previousCursor =
      previousHistory.length > 0
        ? previousHistory[previousHistory.length - 1]
        : null;

    setCursorHistory(previousHistory);
    setCursor(previousCursor);
  }

  function changeSort(field: string) {
    if (sortBy === field) {
      setSortOrder((current) =>
        current === "asc" ? "desc" : "asc",
      );
    } else {
      setSortBy(field);
      setSortOrder(field === "createdAt" ? "desc" : "asc");
    }
  }

  const currentPage = cursorHistory.length + 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Orders Console home">
          <span className="brand-mark">O</span>
          <span>Orders Console</span>
        </a>

        <span className="environment-label">Development</span>
      </header>

      <section className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">OPERATIONS</p>
            <h1>Orders</h1>
            <p className="subtitle">
              Search, filter, and manage customer orders.
            </p>
          </div>

          <div className="order-count">
            <span className="count-indicator" />
            Live API connection
          </div>
        </div>

        <section className="dashboard-card">
          <div className="toolbar">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customer, email, or order..."
                aria-label="Search orders"
              />
              {search && (
                <button
                  className="clear-search"
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </label>

            <label className="filter-control">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as "ALL" | OrderStatus)
                }
              >
                {statuses.map((item) => (
                  <option key={item} value={item}>
                    {item === "ALL" ? "All statuses" : item}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <div>
                <strong>Unable to load orders</strong>
                <p>{error}</p>
              </div>
              <button
                type="button"
                className="retry-button"
                onClick={() => {
                  // Changing cursor triggers a fresh request.
                  setCursor((current) => current);
                  window.location.reload();
                }}
              >
                Retry
              </button>
            </div>
          )}

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <button
                      className="sort-button"
                      onClick={() => changeSort("orderNumber")}
                    >
                      Order {sortBy === "orderNumber" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                    </button>
                  </th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>
                    <button
                      className="sort-button"
                      onClick={() => changeSort("totalAmount")}
                    >
                      Total {sortBy === "totalAmount" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                    </button>
                  </th>
                  <th>
                    <button
                      className="sort-button"
                      onClick={() => changeSort("createdAt")}
                    >
                      Created {sortBy === "createdAt" ? (sortOrder === "asc" ? "↑" : "↓") : "↕"}
                    </button>
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="table-message">
                      <span className="spinner" />
                      Loading orders...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={5} className="table-message">
                      Check that the API is running on port 3000.
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="table-message">
                      No orders found. Try changing your search or filters.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <span className="order-number">
                          {order.orderNumber}
                        </span>
                      </td>
                      <td>
                        <div className="customer-cell">
                          <span className="avatar">
                            {order.customerName.charAt(0).toUpperCase()}
                          </span>
                          <span>
                            <strong>{order.customerName}</strong>
                            <small>{order.customerEmail}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`status-badge status-${order.status.toLowerCase()}`}
                        >
                          {order.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="amount">
                        {formatMoney(order.totalAmount)}
                      </td>
                      <td className="date-cell">
                        {formatDate(order.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <footer className="table-footer">
            <span>
              {loading
                ? "Loading results..."
                : `${orders.length} orders on this page`}
            </span>

            <div className="pagination">
              <button
                type="button"
                disabled={loading || cursorHistory.length === 0}
                onClick={goToPreviousPage}
              >
                ← Previous
              </button>

              <span>Page {currentPage}</span>

              <button
                type="button"
                disabled={loading || !hasMore || !nextCursor}
                onClick={goToNextPage}
              >
                Next →
              </button>
            </div>
          </footer>
        </section>

        <p className="footnote">
          Results are fetched from the API using server-side filtering and
          cursor pagination.
        </p>
      </section>
    </main>
  );
}

export default App;
