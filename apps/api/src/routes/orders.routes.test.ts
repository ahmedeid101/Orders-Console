
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

const mockAuth = vi.hoisted(() => ({
  user: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "ADMIN" as "ADMIN" | "MANAGER" | "CLIENT",
  },
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void,
  ) => {
    res.locals.authUser = mockAuth.user;
    next();
  },
}));

const mockOrders = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    orderNumber: "ORD-000001",
    customerName: "Customer 0001",
    customerEmail: "customer0001@example.test",
    status: "PENDING",
    totalAmount: "150.00",
    createdAt: new Date("2026-01-10T10:00:00.000Z"),
    updatedAt: new Date("2026-01-10T10:00:00.000Z"),
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    orderNumber: "ORD-000002",
    customerName: "Customer 0002",
    customerEmail: "customer0002@example.test",
    status: "COMPLETED",
    totalAmount: "250.00",
    createdAt: new Date("2026-01-11T10:00:00.000Z"),
    updatedAt: new Date("2026-01-11T10:00:00.000Z"),
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    orderNumber: "ORD-000003",
    customerName: "Customer 0003",
    customerEmail: "customer0003@example.test",
    status: "PENDING",
    totalAmount: "350.00",
    createdAt: new Date("2026-01-12T10:00:00.000Z"),
    updatedAt: new Date("2026-01-12T10:00:00.000Z"),
  },
];

describe("GET /api/orders", () => {
  beforeEach(() => {
    mockAuth.user.role = "ADMIN";
    vi.mocked(prisma.order.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list when no orders match", async () => {
    const response = await request(app)
      .get("/api/orders")
      .expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toEqual({
      limit: 20,
      hasMore: false,
      nextCursor: null,
    });
  });

  it("limits the page size and provides a next cursor", async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue(
      mockOrders as never,
    );

    const response = await request(app)
      .get("/api/orders?limit=2")
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination.hasMore).toBe(true);
    expect(response.body.pagination.nextCursor).toBe(
      mockOrders[1].id,
    );

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
  });

  it("applies the status filter", async () => {
    await request(app)
      .get("/api/orders?status=COMPLETED")
      .expect(200);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "COMPLETED",
        }),
      }),
    );
  });

  it("scopes client orders while preserving the other filters", async () => {
    mockAuth.user.role = "CLIENT";

    await request(app)
      .get(
        "/api/orders?status=PENDING&from=2026-01-01T00:00:00.000Z&search=ahmed",
      )
      .expect(200);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: mockAuth.user.id,
          status: "PENDING",
          createdAt: { gte: new Date("2026-01-01T00:00:00.000Z") },
          OR: expect.arrayContaining([
            expect.objectContaining({
              customerName: expect.objectContaining({
                contains: "ahmed",
                mode: "insensitive",
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it.each(["ADMIN", "MANAGER"] as const)(
    "does not restrict %s orders to a single user",
    async (role) => {
      mockAuth.user.role = role;

      await request(app).get("/api/orders").expect(200);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            userId: expect.anything(),
          }),
        }),
      );
    },
  );

  it("applies a case-insensitive search", async () => {
    await request(app)
      .get("/api/orders?search=ahmed")
      .expect(200);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              customerName: expect.objectContaining({
                contains: "ahmed",
                mode: "insensitive",
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it("rejects an invalid status", async () => {
    const response = await request(app)
      .get("/api/orders?status=UNKNOWN")
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a page size above 100", async () => {
    const response = await request(app)
      .get("/api/orders?limit=101")
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid date range", async () => {
    const response = await request(app)
      .get(
        "/api/orders?from=2026-12-31T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
      )
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a nonexistent cursor", async () => {
    const cursor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    vi.mocked(prisma.order.findUnique).mockResolvedValue(null as never);

    const response = await request(app)
      .get(`/api/orders?cursor=${cursor}`)
      .expect(400);

    expect(response.body.error.code).toBe("APPLICATION_ERROR");
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("uses the requested sort direction", async () => {
    await request(app)
      .get("/api/orders?sortBy=totalAmount&sortOrder=asc")
      .expect(200);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { totalAmount: "asc" },
          { id: "asc" },
        ],
      }),
    );
  });
});
