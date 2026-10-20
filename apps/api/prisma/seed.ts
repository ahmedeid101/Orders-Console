
import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  OrderStatus,
  Prisma,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

const CUSTOMER_COUNT = 1_000;
const ORDER_COUNT = 50_000;
const BATCH_SIZE = 1_000;

const statuses: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
];

const products = [
  { id: "PROD-001", name: "Wireless Mouse" },
  { id: "PROD-002", name: "Mechanical Keyboard" },
  { id: "PROD-003", name: "USB-C Hub" },
  { id: "PROD-004", name: "Laptop Stand" },
  { id: "PROD-005", name: "Monitor" },
  { id: "PROD-006", name: "Webcam" },
  { id: "PROD-007", name: "Headphones" },
  { id: "PROD-008", name: "External SSD" },
];

// Realistic first / last names for more natural-looking seed data
const FIRST_NAMES = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael",
  "Linda", "William", "Barbara", "David", "Elizabeth", "Richard", "Susan",
  "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Ahmed",
  "Fatima", "Omar", "Layla", "Yusuf", "Amira", "Hassan", "Nour",
  "Liam", "Olivia", "Noah", "Emma", "Aisha", "Ibrahim", "Zara", "Tariq",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson",
  "Martin", "Lee", "Thompson", "White", "Harris", "Clark", "Al-Rashid",
  "Hassan", "Ahmed", "Khalil", "Mansour", "Ibrahim", "Nasser", "Syed",
  "O'Brien", "Murphy", "Walsh", "Kelly", "Brennan", "Burke", "Collins",
];

function pickName(index: number): { name: string; email: string } {
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[(index * 7) % LAST_NAMES.length];
  const name = `${first} ${last}`;
  // email: firstname.lastname<n>@domain — stays collision-free
  const email = `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}${index}@example.test`;
  return { name, email };
}

async function main() {
  console.log("Starting database seed...");

  // Delete dependent records first to respect foreign-key constraints.
  await prisma.idempotencyRecord.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();

  // ── Named seed users (log-in credentials in the README) ─────────────────
  // Cost factor 12 is standard for bcrypt in 2024/2025.
  const adminHash = hashSync("Admin1234!", 12);
  const agentHash = hashSync("Agent1234!", 12);

  const adminId = randomUUID();
  const agentId  = randomUUID();

  await prisma.user.createMany({
    data: [
      {
        id: adminId,
        name: "Admin User",
        email: "admin@orders.test",
        passwordHash: adminHash,
        role: UserRole.ADMIN,
      },
      {
        id: agentId,
        name: "Agent User",
        email: "agent@orders.test",
        passwordHash: agentHash,
        role: UserRole.MANAGER,  // MANAGER maps to "agent" in the brief
      },
    ],
  });

  console.log("Seed users created:");
  console.log("  admin@orders.test  / Admin1234!  (role: ADMIN)");
  console.log("  agent@orders.test  / Agent1234!  (role: MANAGER)");

  // ── Customer accounts that own the seeded orders ─────────────────────────
  console.log(`\nCreating ${CUSTOMER_COUNT} customers...`);

  const customerHash = hashSync("Password123!", 10);

  const customers = Array.from({ length: CUSTOMER_COUNT }, (_, index) => {
    const { name, email } = pickName(index);
    return {
      id: randomUUID(),
      name,
      email,
      passwordHash: customerHash,
      role: UserRole.CLIENT,
    };
  });

  await prisma.user.createMany({ data: customers });

  const customerIds = customers.map((c) => c.id);
  const now = Date.now();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;

  console.log(`Creating ${ORDER_COUNT.toLocaleString()} orders...`);

  for (
    let batchStart = 0;
    batchStart < ORDER_COUNT;
    batchStart += BATCH_SIZE
  ) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, ORDER_COUNT);

    const orders: Prisma.OrderCreateManyInput[] = [];
    const items:  Prisma.OrderItemCreateManyInput[] = [];

    for (let index = batchStart; index < batchEnd; index++) {
      const orderId = randomUUID();
      const customer = customers[index % CUSTOMER_COUNT];

      // 1-5 items, spread evenly across the batch
      const itemCount = 1 + (index % 5);

      // Dates spread over 12 months, pseudo-random but deterministic
      const createdAt = new Date(
        now - ((index * 7919) % oneYearMs),
      );

      let totalCents = 0;

      for (let i = 0; i < itemCount; i++) {
        const product = products[(index + i) % products.length];
        const quantity = 1 + ((index + i) % 4);
        // Unit price between $5 and $505 — varied but deterministic
        const unitPriceCents = 500 + ((index * 17 + i * 113) % 50_000);

        totalCents += quantity * unitPriceCents;

        items.push({
          id: randomUUID(),
          orderId,
          productId: product.id,
          name: product.name,
          quantity,
          unitPrice: (unitPriceCents / 100).toFixed(2),
          createdAt,
        });
      }

      orders.push({
        id: orderId,
        orderNumber: `ORD-${String(index + 1).padStart(6, "0")}`,
        customerName: customer.name,
        customerEmail: customer.email,
        status: statuses[index % statuses.length],
        totalAmount: (totalCents / 100).toFixed(2),
        createdAt,
        updatedAt: createdAt,
        userId: customer.id,
      });
    }

    // Atomic batch: either all orders + items land, or none do.
    await prisma.$transaction(async (tx) => {
      await tx.order.createMany({ data: orders });
      await tx.orderItem.createMany({ data: items });
    });

    console.log(
      `  Inserted orders ${batchStart + 1}–${batchEnd} / ${ORDER_COUNT}`,
    );
  }

  const [userCount, orderCount, itemCount] = await Promise.all([
    prisma.user.count(),
    prisma.order.count(),
    prisma.orderItem.count(),
  ]);

  console.log("\nSeed completed successfully.");
  console.log({ userCount, orderCount, itemCount });
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
