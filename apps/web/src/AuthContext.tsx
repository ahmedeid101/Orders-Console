import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

export type Role = "ADMIN" | "MANAGER" | "CLIENT";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

type AuthState = {
  user: AuthUser | null;
  token: string | null;
};

type AuthContextValue = AuthState & {
  /** Call with credentials; returns null on success or an error string. */
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
  /** Attach to every API fetch — reads token from closure, never from DOM. */
  authHeader: () => HeadersInit;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Token lives in React state (JS heap).
  // ✓ XSS cannot read it via document.cookie or localStorage.
  // ✗ Lost on page refresh — user must log in again.
  // That is acceptable for an ops console used in active sessions.
  const [state, setState] = useState<AuthState>({ user: null, token: null });

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json();

      if (!res.ok) {
        return body?.error?.message ?? "Login failed";
      }

      setState({ user: body.data.user, token: body.data.accessToken });
      return null; // null = success
    } catch {
      return "Network error — is the API running?";
    }
  }, []);

  const logout = useCallback(() => {
    setState({ user: null, token: null });
  }, []);

  const authHeader = useCallback((): HeadersInit => {
    if (!state.token) return {};
    return { Authorization: `Bearer ${state.token}` };
  }, [state.token]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, authHeader }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Throws if used outside <AuthProvider> — catches wiring mistakes early. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
