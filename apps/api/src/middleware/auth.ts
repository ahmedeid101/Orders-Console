
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

export type AuthUser = {
  id: string;
  role: "ADMIN" | "MANAGER" | "CLIENT";
};

// Typed JWT payload — only fields we actually put in the token
type JwtPayload = {
  sub: string;
  role: AuthUser["role"];
  iat: number;
  exp: number;
};

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    // Accept tokens ONLY from the Authorization header.
    // Never from the query string — query params land in server logs and
    // browser history, leaking long-lived credentials.
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({
        error: { message: "Authentication required" },
      });
      return;
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (!token) {
      res.status(401).json({
        error: { message: "Invalid access token" },
      });
      return;
    }

    let payload: JwtPayload;

    try {
      // jwt.verify (not jwt.decode) — verifies the signature AND expiry.
      // algorithms is pinned to HS256 so an attacker cannot swap to "none"
      // or an asymmetric algorithm to forge a valid token.
      payload = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ["HS256"],
      }) as JwtPayload;
    } catch {
      res.status(401).json({
        error: { message: "Invalid or expired access token" },
      });
      return;
    }

    if (typeof payload.sub !== "string") {
      res.status(401).json({
        error: { message: "Invalid access token" },
      });
      return;
    }

    // Confirm the user still exists (e.g. has not been deleted since the
    // token was issued). One extra DB round-trip per request is acceptable
    // at this scale; at higher scale, add a short-lived revocation cache.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true },
    });

    if (!user) {
      res.status(401).json({
        error: { message: "User no longer exists" },
      });
      return;
    }

    res.locals.authUser = user satisfies AuthUser;
    next();
  } catch (error) {
    next(error);
  }
};

// Factory that returns a middleware enforcing one or more allowed roles.
// Must be used AFTER requireAuth (which sets res.locals.authUser).
export const requireRole = (
  ...roles: AuthUser["role"][]
): RequestHandler => {
  return (_req, res, next) => {
    const user = res.locals.authUser as AuthUser | undefined;

    if (!user) {
      res.status(401).json({
        error: { message: "Authentication required" },
      });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({
        error: {
          message: "You do not have permission to perform this action",
        },
      });
      return;
    }

    next();
  };
};
