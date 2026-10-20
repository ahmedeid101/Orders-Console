
import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const server = app.listen(env.PORT, () => {
  console.log(
    `Orders Console API running at http://localhost:${env.PORT}`,
  );
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received. Shutting down...`);

  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out.");
    process.exit(1);
  }, 10_000);

  forceExit.unref();

  server.close(async (error) => {
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error("Failed to disconnect Prisma:", disconnectError);
      process.exitCode = 1;
    }

    if (error) {
      console.error("HTTP server shutdown failed:", error);
      process.exitCode = 1;
    }

    process.exit();
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
