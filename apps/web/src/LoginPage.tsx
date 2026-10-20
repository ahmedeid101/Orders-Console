import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const err = await login(email.trim(), password);

    setLoading(false);
    if (err) setError(err);
    // On success the parent App re-renders with user != null → shows OrdersPage
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-header">
          <span className="brand-mark login-brand-mark">O</span>
          <h1 className="login-title">Orders Console</h1>
          <p className="login-subtitle">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <label className="field-label">
            Email address
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@orders.test"
              required
              disabled={loading}
              className="field-input"
            />
          </label>

          <label className="field-label">
            Password
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
              className="field-input"
            />
          </label>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            id="login-submit"
            type="submit"
            disabled={loading || !email || !password}
            className="login-button"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="login-hint">
          Demo: <code>admin@orders.test</code> / <code>Admin1234!</code>
        </p>
      </div>
    </main>
  );
}
