#!/usr/bin/env node
// Writes the local env files for every workspace that talks to the database.
// One DATABASE_URL for all of them, so no workspace can drift onto a different
// database than the one the migrations were applied to.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userInfo } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const signingSecret = process.env.STACK_SIGNING_SECRET ?? "miracle-dev-signing-secret";

// Homebrew's Postgres creates a role named after the current user and trusts
// local connections, so development needs no password. A deployment passes its
// own DATABASE_URL (RDS, with credentials) and this default is never used.
const databaseUrl =
  process.env.DATABASE_URL ?? `postgresql://${userInfo().username}@localhost:5432/stack?schema=public`;

const targets = [
  {
    file: join(root, "packages", "db", ".env"),
    body: [`DATABASE_URL="${databaseUrl}"`],
  },
  {
    file: join(root, "apps", "portal", ".env.local"),
    body: [
      `DATABASE_URL="${databaseUrl}"`,
      `STACK_SIGNING_SECRET="${signingSecret}"`,
      `STACK_PORTAL_URL="http://localhost:4200"`,
      `STACK_MCP_URL="http://localhost:4300/mcp"`,
      `STACK_MOCK_GITHUB_ROOT="${join(root, "mock-github")}"`,
    ],
  },
  {
    file: join(root, "apps", "mcp", ".env"),
    body: [
      `DATABASE_URL="${databaseUrl}"`,
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

console.log(`\ndatabase: ${databaseUrl}`);
