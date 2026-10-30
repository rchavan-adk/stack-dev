/** Express bootstrap for the Stack model gateway. */
import express from "express";
import { gatewayPort, loadEnv } from "./env";
import { handleMessages, health } from "./server";

loadEnv();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => {
  res.json(health());
});

app.post("/v1/messages", (req, res, next) => {
  handleMessages(req, res).catch(next);
});

app.use((req, res) => {
  res
    .status(404)
    .json(errorPayload("not_found_error", `no route for ${req.method} ${req.path}`));
});

app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[gateway] unhandled error:", error);
    res.status(500).json(errorPayload("api_error", "gateway internal error"));
  },
);

function errorPayload(type: string, message: string) {
  return { type: "error", error: { type, message } };
}

const port = gatewayPort();
const server = app.listen(port, () => {
  console.log(`stack-gateway listening on http://localhost:${port}`);
  console.log("  POST /v1/messages  (Anthropic Messages proxy, Stack token auth)");
  console.log("  GET  /health");
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("  WARNING: ANTHROPIC_API_KEY is not set; model calls will answer 503.");
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[gateway] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
