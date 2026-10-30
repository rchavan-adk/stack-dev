#!/usr/bin/env node
/**
 * Stack AI MCP server — stdio transport. This is what OpenCode launches as a
 * local MCP server. All logs go to stderr; stdout carries the protocol.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnv } from "./env.js";
import { resolveToken } from "./auth.js";
import { createStackMcpServer } from "./server.js";

loadEnv();

function tokenFromArgv(): string | undefined {
  const argv = process.argv;
  const flagIndex = argv.indexOf("--token");
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  const inline = argv.find((arg) => arg.startsWith("--token="));
  if (inline) return inline.slice("--token=".length);
  return undefined;
}

const token = tokenFromArgv() ?? process.env.STACK_TOKEN;

if (!token) {
  console.error("stack-mcp-stdio: no API token. Pass --token <stk_...> or set STACK_TOKEN.");
  process.exit(1);
}

try {
  const ctx = await resolveToken(token);
  const server = createStackMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `stack-mcp-stdio: ready as ${ctx.user.name} (${ctx.role}${
      ctx.project ? `, scoped to ${ctx.project.key}` : ""
    })`,
  );
} catch (error) {
  console.error(`stack-mcp-stdio: ${error instanceof Error ? error.message : "startup failed"}`);
  process.exit(1);
}
