import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mint a real JWT for the given userId so tests go through requireAuth. */
function makeToken(userId: string): string {
  return jwt.sign(
    { role: "CLIENT" },
    env.JWT_SECRET,
    { algorithm: "HS256", subject: userId, expiresIn: "15m" },
  );
}

/** A valid order payload with free-form items (name + qty + unitPriceCents). */
const payload = {
  customerName: "Integration Test Customer",
  customerEmail: "integration@example.test",
  items: [
    { name: "Wireless Mouse",  qty: 2, unitPriceCents: 2500 },
    { name: "USB-C Hub",       qty: 1, unitPriceCents: 3500 },
  ],
  // Expected total: 2*2500 + 1*3500 = 8500 cents = $85.00
};

// ── Suite ──────────────────────────────────────────────────────────────────

describe("POST /api/orders — integration", () => {
  let userId: string;
  let token: string;

  async function createOrder(key: string, body = payload) {
    return request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(body);
  }

  beforeAll(async () => {
    // Guard: never run against the main DB.
    if (!process.env.DATABASE_URL?.includes("orders_console_test")) {
      throw new Error(
        "Refusing to run integration tests without orders_console_test in DATABASE_URL",
      );
    }

    const user = await prisma.user.create({
      data: {
        name: "Order Integration Tester",
        email: `order-test-${randomUUID()}@example.test`,
        passwordHash: "test-only-not-a-real-password",
        role: "CLIENT",
      },
    });

    userId = user.id;
    token  = makeToken(userId);
  });

  beforeEach(async () => {
    // Clean the test user's orders between tests so each test is isolated.
    await prisma.idempotencyRecord.deleteMany({ where: { userId } });
    await prisma.order.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    if (userId) {
      await prisma.idempotencyRecord.deleteMany({ where: { userId } });
      await prisma.order.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("creates an order and calculates its total on the server", async () => {
    const response = await createOrder(randomUUID());

    expect(response.status).toBe(201);

    const order = response.body.data;
    expect(order.id).toBeDefined();
    expect(order.items).toHaveLength(2);
    // Server recomputes total from items — matches our payload above
    expect(Number(order.totalAmount)).toBe(85);

    const savedCount = await prisma.order.count({ where: { userId } });
    expect(savedCount).toBe(1);
  });

  it("returns the original order for a repeated key and identical payload", async () => {
    const key = randomUUID();

    const first  = await createOrder(key);
    const second = await createOrder(key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    expect(await prisma.order.count({ where: { userId } })).toBe(1);
  });

  it("returns 422 for the same key with a different payload", async () => {
    const key = randomUUID();

    const first = await createOrder(key);

    const changedPayload = {
      ...payload,
      customerName: "A Different Customer",
    };

    const second = await createOrder(key, changedPayload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(422);
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
  });

  it("does not create duplicate orders for concurrent requests with the same key", async () => {
    const key = randomUUID();

    // Fire both requests simultaneously — only one transaction should win.
    const [first, second] = await Promise.all([
      createOrder(key),
      createOrder(key),
    ]);

    // Both responses must refer to the same order.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual(second.body);

    // Exactly one order and one idempotency record in the DB.
    expect(await prisma.order.count({ where: { userId } })).toBe(1);
    expect(
      await prisma.idempotencyRecord.count({ where: { userId, key } }),
    ).toBe(1);
  });
});
