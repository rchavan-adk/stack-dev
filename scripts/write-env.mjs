#!/usr/bin/env node
// Writes the local env files for every workspace that talks to the database.
// SQLite relative paths resolve differently per tool, so each file gets an absolute path.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbFile = join(root, "packages", "db", "prisma", "stack.db");
const signingSecret = process.env.STACK_SIGNING_SECRET ?? "miracle-dev-signing-secret";

const targets = [
  {
    file: join(root, "packages", "db", ".env"),
    body: [`DATABASE_URL="file:${dbFile}"`],
  },
  {
    file: join(root, "apps", "portal", ".env.local"),
    body: [
      `DATABASE_URL="file:${dbFile}"`,
      `STACK_SIGNING_SECRET="${signingSecret}"`,
      `STACK_PORTAL_URL="http://localhost:4200"`,
      `STACK_MCP_URL="http://localhost:4300/mcp"`,
      `STACK_MOCK_GITHUB_ROOT="${join(root, "mock-github")}"`,
    ],
  },
  {
    file: join(root, "apps", "mcp", ".env"),
    body: [
      `DATABASE_URL="file:${dbFile}"`,
      `STACK_SIGNING_SECRET="${signingSecret}"`,
      `STACK_PORTAL_URL="http://localhost:4200"`,
      `STACK_MCP_PORT="4300"`,
    ],
  },
];

for (const target of targets) {
  mkdirSync(dirname(target.file), { recursive: true });
  writeFileSync(target.file, target.body.join("\n") + "\n");
  console.log(`wrote ${target.file.replace(root + "/", "")}`);
}

console.log(`\ndatabase: ${dbFile}`);
