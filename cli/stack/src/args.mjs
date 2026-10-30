/** Minimal argument parser: `--flag`, `--flag=value`, `--flag value`, `-h`. */

import { UsageError } from "./errors.mjs";

/**
 * spec = { flags: { name: "boolean" | "value" }, aliases: { h: "help" } }
 * Returns { _, flags } where flags only contains what the caller declared.
 */
export function parseArgs(argv, { flags = {}, aliases = {} } = {}) {
  const positionals = [];
  const values = {};
  const tokens = [...argv];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") {
      positionals.push(...tokens.slice(index + 1));
      break;
    }
    if (token.startsWith("--")) {
      const [rawName, inlineValue] = splitFlag(token.slice(2));
      const name = aliases[rawName] ?? rawName;
      const kind = flags[name];
      if (!kind) throw new UsageError(`unknown option --${rawName}`, { fix: "stack help" });
      if (kind === "boolean") {
        if (inlineValue !== undefined) {
          values[name] = !["0", "false", "no"].includes(inlineValue.toLowerCase());
        } else {
          values[name] = true;
        }
        continue;
      }
      if (inlineValue !== undefined) {
        values[name] = inlineValue;
        continue;
      }
      const next = tokens[index + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-" && !/^-\d/.test(next))) {
        throw new UsageError(`option --${rawName} needs a value`, { fix: "stack help" });
      }
      values[name] = next;
      index += 1;
      continue;
    }
    if (token.startsWith("-") && token.length > 1 && token !== "-") {
      const name = aliases[token.slice(1)] ?? token.slice(1);
      const kind = flags[name];
      if (!kind) throw new UsageError(`unknown option ${token}`, { fix: "stack help" });
      if (kind === "boolean") {
        values[name] = true;
        continue;
      }
      const next = tokens[index + 1];
      if (next === undefined) throw new UsageError(`option ${token} needs a value`, { fix: "stack help" });
      values[name] = next;
      index += 1;
      continue;
    }
    positionals.push(token);
  }

  return { _: positionals, flags: values };
}

function splitFlag(text) {
  const index = text.indexOf("=");
  if (index < 0) return [text, undefined];
  return [text.slice(0, index), text.slice(index + 1)];
}

/** Parse an integer option, failing with a usage error when it is not one. */
export function intFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  const value = Number(flags[name]);
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError(`--${name} must be a non-negative integer`, { fix: "stack help" });
  }
  return value;
}

/** Required positional argument. */
export function requirePositional(ctx, index, placeholder, usage) {
  const value = ctx.args[index];
  if (value === undefined || value === "") {
    throw new UsageError(`missing ${placeholder}`, { fix: usage });
  }
  return value;
}
