import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("ENV ERROR - DATABASE_URL is missing");

export const db = drizzle(databaseUrl, { schema });
