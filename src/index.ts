/**
 * OpenClaw Cloud Bridge - Entry Point
 */

import { startServer } from "./server.js";
import { db } from "./database-memory.js";

// Init database and start server
db.connect().then(() => {
  console.log("[DB] Database ready");
  startServer();
}).catch((err: Error) => {
  console.error("[DB] Database connection failed:", err);
  process.exit(1);
});
