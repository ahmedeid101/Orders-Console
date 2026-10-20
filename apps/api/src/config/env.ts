import "dotenv/config";
import { z } from "zod";

 const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default("15m"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    FRONTEND_URL: z.string().url().default("http://localhost:5173"),
 }) 

 const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration:");
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;