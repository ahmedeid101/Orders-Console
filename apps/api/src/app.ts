import { env } from "./config/env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import authRouter from "./routes/auth.routes.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { orderCreateRouter } from "./routes/order-create.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";

export const app = express();

app.disable("x-powered-by");

app.use(helmet());

app.use(
  cors({
    origin: env.FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
    ],
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use("/api", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/orders", orderCreateRouter);

// Unknown routes should return a consistent JSON response.
app.use(notFoundHandler);

// Error middleware must be registered after routes.
app.use(errorHandler);
