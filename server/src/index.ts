import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from both server/src (tsx) and dist/server/server/src (compiled).
const root = here.includes(`${path.sep}dist${path.sep}`) ? path.resolve(here, "../../../..") : path.resolve(here, "../..");

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DATABASE_PATH ?? path.join(root, "data", "pollcast.db");
mkdirSync(path.dirname(dbPath), { recursive: true });

const { httpServer, close } = createApp({ dbPath, clientDir: path.join(root, "dist", "client") });

httpServer.listen(port, () => {
  console.log(`Pollcast listening on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await close();
    httpServer.close(() => process.exit(0));
  });
}
