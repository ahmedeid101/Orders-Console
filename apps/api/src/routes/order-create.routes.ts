
import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { requireAuth, type AuthUser } from "../middleware/auth.js";

export const orderCreateRouter = Router();

// Each line item carries its own price so the form drives pricing.
// The server recomputes totalAmount from items — the client value is ignored.
const createOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerEmail: z.string().trim().email().max(254),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        qty: z.number().int().min(1).max(100),
        // unit price in whole cents — avoids floating-point money on the wire
        unitPriceCents: z.number().int().min(1).max(100_000_00),
      }),
    )
    .min(1)
    .max(5),
});

// Stable hash of the request payload used to detect key reuse with a
// different body. Keys in objects are sorted so {"a":1,"b":2} and
// {"b":2,"a":1} produce the same hash.
function hashRequest(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return item;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// Postgres unique-violation code via Prisma
function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

orderCreateRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    // ── 1. Validate the Idempotency-Key header ──────────────────────────────
    const idempotencyKey = req.header("Idempotency-Key");

    if (
      !idempotencyKey ||
      idempotencyKey.length > 200 ||
      idempotencyKey.trim() !== idempotencyKey
    ) {
      throw new AppError(
        400,
        "A valid Idempotency-Key header is required",
      );
    }

    // ── 2. Get the authenticated user (set by requireAuth) ──────────────────
    const authUser = res.locals.authUser as AuthUser;

    // ── 3. Validate the request body ────────────────────────────────────────
    const input = createOrderSchema.parse(req.body);
    const requestHash = hashRequest(input);

    // ── 4. Check for an existing record BEFORE the transaction ──────────────
    // This fast path avoids starting a transaction on every retry.
    const existing = await prisma.idempotencyRecord.findUnique({
      where: {
        userId_key: {
          userId: authUser.id,
          key: idempotencyKey,
        },
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        // Same key, different payload → caller error
        throw new AppError(
          422,
          "This idempotency key was already used with a different request",
        );
      }

      if (existing.responseStatus && existing.responseBody) {
        // Happy path retry: return the stored response unchanged
        res
          .status(existing.responseStatus)
          .json(existing.responseBody);
        return;
      }

      // Record exists but has no response stored — the transaction is
      // still in flight (or crashed). Tell the client to retry.
      throw new AppError(
        409,
        "This request is being processed; retry shortly",
      );
    }

    // ── 5. Compute totals server-side (client value is never trusted) ────────
    const totalCents = input.items.reduce(
      (sum, item) => sum + item.qty * item.unitPriceCents,
      0,
    );

    const orderId = randomUUID();
    const orderNumber = `ORD-${randomUUID()
      .replaceAll("-", "")
      .slice(0, 12)
      .toUpperCase()}`;

    const responseBody = {
      data: {
        id: orderId,
        orderNumber,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        status: "PENDING",
        // Store as decimal string matching Prisma Decimal serialisation
        totalAmount: (totalCents / 100).toFixed(2),
        items: input.items.map((item) => ({
          name: item.name,
          qty: item.qty,
          unitPrice: (item.unitPriceCents / 100).toFixed(2),
        })),
      },
    };

    // ── 6. Insert idempotency record + order atomically ──────────────────────
    // The unique constraint on (userId, key) serialises concurrent requests
    // with the same key — only one INSERT wins; the other gets P2002.
    try {
      await prisma.$transaction(async (tx) => {
        await tx.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            requestHash,
            userId: authUser.id,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

        await tx.order.create({
          data: {
            id: orderId,
            orderNumber,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            status: "PENDING",
            totalAmount: (totalCents / 100).toFixed(2),
            userId: authUser.id,
            items: {
              create: input.items.map((item) => ({
                productId: "CUSTOM",
                name: item.name,
                quantity: item.qty,
                unitPrice: (item.unitPriceCents / 100).toFixed(2),
              })),
            },
          },
        });

        // Stamp the record with the response so retries can replay it.
        await tx.idempotencyRecord.update({
          where: {
            userId_key: {
              userId: authUser.id,
              key: idempotencyKey,
            },
          },
          data: {
            responseStatus: 201,
            responseBody: responseBody as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });
      });

      res.status(201).json(responseBody);
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      // A concurrent request won the race for this key.
      // Re-fetch the completed record and replay its response.
      const record = await prisma.idempotencyRecord.findUnique({
        where: {
          userId_key: {
            userId: authUser.id,
            key: idempotencyKey,
          },
        },
      });

      if (!record) {
        // Unique violation from something unrelated — re-throw.
        throw error;
      }

      if (record.requestHash !== requestHash) {
        throw new AppError(
          422,
          "This idempotency key was already used with a different request",
        );
      }

      if (record.responseStatus && record.responseBody) {
        res.status(record.responseStatus).json(record.responseBody);
        return;
      }

      throw new AppError(
        409,
        "This request is being processed; retry shortly",
      );
    }
  } catch (error) {
    next(error);
  }
});
