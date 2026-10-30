/**
 * Stack AI MCP server — Streamable HTTP transport.
 *
 * Stateless: every POST /mcp builds a fresh MCP server from the bearer token,
 * so tool visibility is decided per request and no session state is kept.
 */
import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadEnv } from "./env.js";
import { mcpPort } from "./env.js";
import { AuthError, resolveToken } from "./auth.js";
import { TOOL_COUNT, createStackMcpServer } from "./server.js";

loadEnv();

const PORT = mcpPort();

function logHttp(message: string): void {
  console.error(`${new Date().toISOString()} [http] ${message}`);
}

/** JSON-RPC error body with an HTTP status; used for auth and method errors. */
function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, tools: TOOL_COUNT, transport: "streamable-http" });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const header = req.headers.authorization;
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  const token = match?.[1]?.trim();
  if (!token) {
    logHttp("auth failed: missing bearer token");
    return jsonRpcError(res, 401, -32001, "Unauthorized: pass the API token in the Authorization: Bearer header.");
  }
  let ctx;
  try {
    ctx = await resolveToken(token);
  } catch (error) {
    const message = error instanceof AuthError ? error.message : "token lookup failed";
    logHttp(`auth failed: ${message}`);
    return jsonRpcError(res, 401, -32001, `Unauthorized: ${message}.`);
  }
  const server = createStackMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logHttp(`request failed: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal error.");
  }
});

// Stateless MCP answers GET/DELETE with the documented 405 JSON-RPC error.
const methodNotAllowed = (_req: Request, res: Response): void => {
  res.setHeader("Allow", "POST");
  jsonRpcError(res, 405, -32000, "Method not allowed.");
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

const httpServer = app.listen(PORT, () => {
  // The port it bound, not a URL anyone else can use: in a deployment this is
  // the container's own interface behind the load balancer.
  logHttp(`stack-mcp listening on port ${PORT} (${TOOL_COUNT} tools, stateless streamable-http at /mcp)`);
});

process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  httpServer.close(() => process.exit(0));
});
