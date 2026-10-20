import { Router } from "express";
import { OrderStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { requireAuth, type AuthUser } from "../middleware/auth.js";
import { env } from "../config/env.js";

export const ordersRouter = Router();

const sortableFields = [
  "createdAt",
  "customerName",
  "orderNumber",
  "totalAmount",
] as const;

type SortField = (typeof sortableFields)[number];

const querySchema = z
  .object({
    search: z.string().trim().max(100).optional(),

    status: z.nativeEnum(OrderStatus).optional(),

    from: z.coerce.date().optional(),
    to:   z.coerce.date().optional(),

    sortBy:    z.enum(sortableFields).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),

    limit: z.coerce.number().int().min(1).max(100).default(20),

    cursor: z.string().uuid().optional(),

    // Dev-only: artificial response delay in ms.
    // Lets you demonstrate the race-condition guard in the screen recording.
    // Capped at 5 s; ignored outside development.
    delay: z.coerce.number().int().min(0).max(5000).optional(),
  })
  .superRefine((query, ctx) => {
    if (
      query.from &&
      query.to &&
      query.from.getTime() > query.to.getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "'from' must be earlier than or equal to 'to'",
      });
    }
  });

ordersRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const query = querySchema.parse(req.query);

    // ── Dev latency hook ───────────────────────────────────────────────────
    // Only available in development so it cannot be abused in production.
    if (env.NODE_ENV === "development" && query.delay) {
      await new Promise((resolve) => setTimeout(resolve, query.delay));
    }

    const authUser = res.locals.authUser as AuthUser;

    // CLIENT users can only see their own orders.
    // ADMIN and MANAGER see everything.
    const where: Prisma.OrderWhereInput = {
      ...(authUser.role === "CLIENT" ? { userId: authUser.id } : {}),
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to   ? { lte: query.to   } : {}),
      };
    }

    // Search by customer name, email, or order number.
    // Postgres's `mode: "insensitive"` maps to ILIKE — uses the GIN/btree
    // index when searching a prefix, but a leading wildcard would disable it.
    // We deliberately do NOT add a leading wildcard; agents are expected to
    // type at least the start of a name/email.
    if (query.search) {
      where.OR = [
        { customerName:  { contains: query.search, mode: "insensitive" } },
        { customerEmail: { contains: query.search, mode: "insensitive" } },
        { orderNumber:   { contains: query.search, mode: "insensitive" } },
      ];
    }

    // Validate the cursor row exists before issuing the main query.
    // Avoids returning an empty page for a stale/invalid cursor.
    if (query.cursor) {
      const cursorExists = await prisma.order.findUnique({
        where: { id: query.cursor },
        select: { id: true },
      });

      if (!cursorExists) {
        throw new AppError(400, "Invalid pagination cursor");
      }
    }

    // Keyset pagination with a stable tiebreaker (id).
    // The id tiebreaker means the sort key does NOT need to be unique —
    // two orders with the same createdAt are still ordered deterministically.
    const orderBy: Prisma.OrderOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { id: query.sortOrder },
    ];

    // Fetch one extra row to determine whether another page exists.
    const rows = await prisma.order.findMany({
      where,
      orderBy,
      take: query.limit + 1,
      ...(query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
      select: {
        id:            true,
        orderNumber:   true,
        customerName:  true,
        customerEmail: true,
        status:        true,
        totalAmount:   true,
        createdAt:     true,
        updatedAt:     true,
      },
    });

    const hasMore = rows.length > query.limit;
    const orders  = hasMore ? rows.slice(0, query.limit) : rows;

    const nextCursor =
      hasMore && orders.length > 0
        ? orders[orders.length - 1].id
        : null;

    res.status(200).json({
      data: orders,
      pagination: {
        limit:      query.limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    next(error);
  }
});
