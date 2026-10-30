/**
 * `stack` — the developer CLI for the Stack AI delivery platform.
 *
 * Dispatches to one module per command under src/commands/. Exit codes:
 *   0 success · 1 expected failure · 2 usage error.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.mjs";
import { createContext } from "./context.mjs";
import { UsageError } from "./errors.mjs";
import * as ui from "./ui.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = JSON.parse(readFileSync(path.join(HERE, "..", "package.json"), "utf8"));

const GLOBAL_FLAGS = {
  json: "boolean",
  portal: "value",
  token: "value",
  help: "boolean",
  version: "boolean",
  "mcp-url": "value",
};

const COMMANDS = [
  {
    name: "login",
    file: "login.mjs",
    group: "Get started",
    flags: {},
    summary: "Sign this machine in to the portal",
    usage: "stack login [--portal URL] [--token TOKEN]",
  },
  {
    name: "whoami",
    file: "whoami.mjs",
    group: "Get started",
    flags: {},
    summary: "Show the signed-in developer and their projects",
    usage: "stack whoami",
  },
  {
    name: "project detect",
    file: "project-detect.mjs",
    group: "Get started",
    flags: { project: "value" },
    summary: "Detect and link this repository to a project",
    usage: "stack project detect [--project KEY]",
  },
  {
    name: "project list",
    file: "project-list.mjs",
    group: "Get started",
    flags: {},
    summary: "List the projects you can see",
    usage: "stack project list [--json]",
  },
  {
    name: "link",
    file: "project-link.mjs",
    group: "Get started",
    flags: {},
    summary: "Link this repository to a project by key",
    usage: "stack link <KEY>",
  },
  {
    name: "logout",
    file: "logout.mjs",
    group: "Get started",
    flags: {},
    summary: "Remove the local credentials file",
    usage: "stack logout",
  },
  {
    name: "issues",
    file: "issues.mjs",
    group: "Daily work",
    flags: { mine: "boolean", status: "value", project: "value" },
    summary: "List work items for this repo's project",
    usage: "stack issues [--mine] [--status S] [--project KEY]",
  },
  {
    name: "claim",
    file: "claim.mjs",
    group: "Daily work",
    flags: {},
    summary: "Claim an item and start a session on it",
    usage: "stack claim <HANDLE>",
  },
  {
    name: "status",
    file: "status.mjs",
    group: "Daily work",
    flags: { note: "value" },
    summary: "Propose a status change on an item",
    usage: "stack status <HANDLE> <STATUS> [--note TEXT]",
  },
  {
    name: "verify",
    file: "verify.mjs",
    group: "Daily work",
    flags: { base: "value" },
    summary: "Run the pack's stack-verify checks on this branch",
    usage: "stack verify [--base REF]",
  },
  {
    name: "harness install",
    file: "harness-install.mjs",
    group: "Harness",
    flags: { force: "boolean", default: "boolean", project: "value" },
    summary: "Install the harness pack for this repo (project or default)",
    usage: "stack harness install [--force] [--default] [--project KEY]",
  },
  {
    name: "harness status",
    file: "harness-status.mjs",
    group: "Harness",
    flags: {},
    summary: "Compare the installed pack with the published one",
    usage: "stack harness status [--json]",
  },
  {
    name: "mcp install",
    file: "mcp-install.mjs",
    group: "Harness",
    flags: { agent: "value", mode: "value" },
    summary: "Wire the Stack MCP server into your agent",
    usage: "stack mcp install [--agent opencode|droid|claude] [--mode remote|local]",
  },
  {
    name: "doctor",
    file: "doctor.mjs",
    group: "Harness",
    flags: {},
    summary: "Check credentials, link, pack, hooks, MCP and gateway",
    usage: "stack doctor [--json]",
  },
  {
    name: "model-call",
    file: "model-call.mjs",
    group: "Gateway",
    flags: { model: "value", item: "value", "tokens-in": "value", "tokens-out": "value" },
    summary: "Ask the gateway whether a model call is allowed",
    usage: "stack model-call --model M [--item HANDLE] [--tokens-in N] [--tokens-out N]",
  },
];

const GROUPS = ["Get started", "Daily work", "Harness", "Gateway"];

const PREFIXES = {
  project: ["project detect", "project list", "link"],
  harness: ["harness install", "harness status"],
  mcp: ["mcp install"],
};

/**
 * Long spellings that resolve to an existing command. `stack project link <KEY>`
 * is what the default-harness install message tells developers to run, so it has
 * to work, not just `stack link <KEY>`.
 */
const COMMAND_ALIASES = {
  "project link": "link",
};

export async function main(argv) {
  try {
    return await dispatch(argv);
  } catch (error) {
    if (error?.expected) {
      ui.errorLine(error.message, error.fix);
      if (error.detail) process.stderr.write(`        ${ui.muted(error.detail)}\n`);
      return error.exitCode ?? 1;
    }
    if (process.env.STACK_DEBUG) {
      process.stderr.write(`${error?.stack ?? String(error)}\n`);
      return 1;
    }
    ui.errorLine(error?.message ?? String(error), "STACK_DEBUG=1 stack \u2026  # full stack trace");
    return 1;
  }
}

async function dispatch(argv) {
  if (argv.length === 0) {
    printHelp();
    return 0;
  }
  const first = argv[0];
  if (first === "--version" || first === "-v" || first === "version") {
    printVersion();
    return 0;
  }
  if (first === "--help" || first === "-h") {
    printHelp();
    return 0;
  }
  if (first === "help") {
    const name = argv.slice(1).join(" ").trim();
    const command = COMMANDS.find((entry) => entry.name === (COMMAND_ALIASES[name] ?? name));
    if (command) printCommandHelp(command);
    else if (PREFIXES[name]) printPrefixHelp(name);
    else printHelp();
    return 0;
  }

  const resolved = resolveCommand(argv);
  if (!resolved) {
    if (PREFIXES[first]) {
      printPrefixHelp(first);
      return 0;
    }
    throw new UsageError(`unknown command "${argv.join(" ")}"`, { fix: "stack help" });
  }

  const { command, consumed } = resolved;
  const parsed = parseArgs(argv.slice(consumed), {
    flags: { ...GLOBAL_FLAGS, ...command.flags },
    aliases: { h: "help", v: "version" },
  });
  if (parsed.flags.version) {
    printVersion();
    return 0;
  }
  if (parsed.flags.help) {
    printCommandHelp(command);
    return 0;
  }

  const ctx = createContext({ flags: parsed.flags, positionals: parsed._ });
  const module = await import(new URL(`./commands/${command.file}`, import.meta.url));
  const code = await module.run(ctx);
  return typeof code === "number" ? code : 0;
}

function resolveCommand(argv) {
  const twoWord = argv.length >= 2 ? `${argv[0]} ${argv[1]}` : "";
  if (twoWord) {
    const command = COMMANDS.find((entry) => entry.name === (COMMAND_ALIASES[twoWord] ?? twoWord));
    if (command) return { command, consumed: 2 };
  }
  const command = COMMANDS.find((entry) => entry.name === argv[0]);
  if (command) return { command, consumed: 1 };
  return null;
}

function printVersion() {
  ui.line(`stack ${PACKAGE.version}`);
}

function printCommandHelp(command) {
  ui.heading(command.usage);
  ui.blank();
  ui.info(`  ${command.summary}`);
  const flags = Object.keys(command.flags ?? {});
  if (flags.length) {
    ui.section("Options");
    for (const flag of flags) {
      ui.info(`  --${flag}`);
    }
  }
  ui.section("Global options");
  ui.info("  --json           machine-readable output on read commands");
  ui.info("  --portal URL     override the portal URL");
  ui.info("  --mcp-url URL    override the Stack MCP URL");
  ui.info("  -h, --help       show this help");
  ui.info("  -v, --version    print the CLI version");
  ui.blank();
}

function printPrefixHelp(prefix) {
  const names = PREFIXES[prefix] ?? [];
  ui.heading(`stack ${prefix}`);
  ui.blank();
  for (const name of names) {
    const command = COMMANDS.find((entry) => entry.name === name);
    if (!command) continue;
    ui.line(`  ${ui.code(command.usage.padEnd(34))} ${command.summary}`);
  }
  ui.blank();
}

function printHelp() {
  const width = Math.min(
    64,
    Math.max(...COMMANDS.map((command) => command.usage.length)) + 2,
  );
  ui.heading("stack \u2014 the Stack AI developer CLI");
  ui.blank();
  ui.info(`  ${ui.muted("usage")}  stack <command> [options]`);
  for (const group of GROUPS) {
    ui.section(group);
    for (const command of COMMANDS.filter((entry) => entry.group === group)) {
      ui.line(`  ${ui.code(command.usage.padEnd(width))} ${command.summary}`);
    }
  }
  ui.section("Global options");
  ui.info("  --json           machine-readable output on read commands");
  ui.info("  --portal URL     override the portal URL");
  ui.info("  --token TOKEN    token for `stack login` (or STACK_TOKEN)");
  ui.info("  --mcp-url URL    override the Stack MCP URL");
  ui.info("  -h, --help       show this help, or help for one command");
  ui.info("  -v, --version    print the CLI version");
  ui.section("Exit codes");
  ui.info("  0 success \u00b7 1 expected failure \u00b7 2 usage error");
  ui.blank();
}
