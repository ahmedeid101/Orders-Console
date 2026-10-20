
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import rateLimit from "express-rate-limit";

import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthUser } from "../middleware/auth.js";
import type { UserRole } from "@prisma/client";

const authRouter = Router();

// 10 attempts per 15 minutes per IP — prevents password bruteforce.
// windowMs / max chosen so a legitimate user who mis-types a few times
// is never locked out, but automated spraying is slowed to ~40/hour.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,  // Return `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many login attempts. Please try again in 15 minutes.",
    },
  },
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(72),
});

function issueAccessToken(user: { id: string; role: UserRole }) {
  // Only the subject (user id) and role go into the token.
  // Nothing sensitive (email, name) — minimise payload exposure.
  return jwt.sign(
    { role: user.role },
    env.JWT_SECRET,
    {
      algorithm: "HS256",               // Pinned — rejects RS/ES tokens
      subject: user.id,
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    },
  );
}

// POST /api/auth/login
authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      // Return a generic message — don't tell the caller which field failed
      // as that leaks whether the email exists.
      res.status(400).json({
        error: { message: "Invalid email or password" },
      });
      return;
    }

    const email = parsed.data.email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Always run bcrypt.compare even when user is null so the response time
    // is constant regardless of whether the email exists (timing-safe).
    const DUMMY_HASH =
      "$2b$12$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    const passwordMatches = await bcrypt.compare(
      parsed.data.password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    if (!user || !passwordMatches) {
      res.status(401).json({
        error: { message: "Invalid email or password" },
      });
      return;
    }

    const accessToken = issueAccessToken(user);

    res.status(200).json({
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        accessToken,
        tokenType: "Bearer",
        expiresIn: env.JWT_EXPIRES_IN,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me  — returns the currently authenticated user
authRouter.get("/me", requireAuth, (req, res) => {
  const authUser = res.locals.authUser as AuthUser;
  res.status(200).json({ data: authUser });
});

export default authRouter;
