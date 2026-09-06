/**
 * Idempotent clean-up that runs before `drizzle-kit push`.
 *
 * `drizzle-kit push` asks interactively whether a dropped table/column was
 * renamed into a newly added one; in non-interactive shells (make, docker
 * exec -T) that prompt aborts the push. Dropping the obsolete objects first
 * turns the diff into plain creates and lets the push run unattended.
 *
 * Endläufe 2026, September 2026: live timing was split from the official
 * results — `endlauf26_finalizations` and the finish/points columns of
 * `endlauf26_entries` are gone, replaced by `endlauf26_results`.
 *
 * Run:  cd webapp && npm run db:pre-push   (called by `npm run db:push`)
 */
import "dotenv/config";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("ENV ERROR - DATABASE_URL is missing");

const STATEMENTS = [
  "DROP TABLE IF EXISTS endlauf26_finalizations",
  "ALTER TABLE IF EXISTS endlauf26_entries DROP COLUMN IF EXISTS finish_position",
  "ALTER TABLE IF EXISTS endlauf26_entries DROP COLUMN IF EXISTS points_awarded",
];

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const sql of STATEMENTS) {
      await pool.query(sql);
      console.log(`  ok: ${sql}`);
    }
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
