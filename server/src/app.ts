import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { Server } from "socket.io";
import { openDatabase } from "./db.js";
import { AppError } from "./errors.js";
import { RateLimiter } from "./rateLimit.js";
import { attachRealtime, type IO, type RealtimeOptions } from "./realtime.js";
import { Store } from "./store.js";
import { parse, schemas } from "./validation.js";

export interface AppOptions extends RealtimeOptions {
  dbPath?: string;
  /** Directory with the built client; served when it exists. */
  clientDir?: string;
  /** Session creations allowed per IP per hour. */
  createLimitPerHour?: number;
}

export function createApp(opts: AppOptions = {}) {
  const db = openDatabase(opts.dbPath ?? ":memory:");
  const store = new Store(db);
  const app = express();
  const httpServer = createHttpServer(app);
  const io: IO = new Server(httpServer, { serveClient: false, maxHttpBufferSize: 16_000 });
  const realtime = attachRealtime(io, store, opts);
  const perHour = opts.createLimitPerHour ?? 20;
  const createLimiter = new RateLimiter(perHour, perHour / 3600);

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10kb" }));
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/sessions", (req, res) => {
    if (!createLimiter.take(req.ip ?? "unknown")) {
      throw new AppError("Too many sessions created from this network. Try again later.", 429);
    }
    const { title } = parse(schemas.createSession, req.body ?? {});
    const { code, hostToken } = store.createSession(title);
    res.status(201).json({ code, title, hostToken });
  });

  app.get("/api/sessions/:code", (req, res) => {
    const s = store.findSession(String(req.params.code));
    res.json({ code: s.code, title: s.title, createdAt: s.created_at, endedAt: s.ended_at });
  });

  app.use("/api", (_req, _res, next) => next(new AppError("Not found", 404)));

  if (opts.clientDir && existsSync(opts.clientDir)) {
    const clientDir = opts.clientDir;
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    // Single-page app: every other route renders index.html.
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "Request body must be valid JSON" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server" });
  });

  const close = async () => {
    realtime.flushAll();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    db.close();
  };

  return { app, httpServer, io, store, close };
}
