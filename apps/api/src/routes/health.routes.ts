import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const healthRouter = Router();

// Checks whether the API process is alive.
healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "orders-console-api",
  });
});

// Checks whether the API can reach PostgreSQL.
healthRouter.get("/ready", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ready",
      database: "connected",
    });
  } catch (error) {
    next(error);
  }
});
