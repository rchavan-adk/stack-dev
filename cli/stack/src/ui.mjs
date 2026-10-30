/**
 * Terminal output: ANSI colours, tables, diffs and prompts. No dependencies.
 *
 * Everything is indented by two spaces so command output lines up under the
 * heading a command prints.
 */

const useColor = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
})();

const wrap = (code) => (text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : String(text));

export const style = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
  gray: wrap("90"),
};

/** Colour a value the way commands do: cyan for commands, bold for names. */
export const code = (text) => style.cyan(String(text));
export const strong = (text) => style.bold(String(text));
export const muted = (text) => style.dim(String(text));

export function line(text = "") {
  process.stdout.write(`${text}\n`);
}

export function blank() {
  process.stdout.write("\n");
}

export function heading(text) {
  blank();
  line(`  ${style.bold(text)}`);
}

export function section(text) {
  blank();
  line(`  ${style.bold(text)}`);
}

/** "  ok    message" */
export function ok(text) {
  line(`  ${style.green("ok")}    ${text}`);
}

/** "  warn  message" */
export function warn(text) {
  line(`  ${style.yellow("warn")}  ${text}`);
}

/** "  FAIL  message" */
export function fail(text) {
  line(`  ${style.red("FAIL")}  ${text}`);
}

/** "  !     message" */
export function notice(text) {
  line(`  ${style.yellow("!")}     ${text}`);
}

export function info(text) {
  line(`  ${text}`);
}

/** "      fix: <command>" */
export function hint(fix) {
  if (!fix) return;
  line(`        ${style.dim("fix:")} ${code(fix)}`);
}

export function bullet(text) {
  line(`    ${style.gray("-")} ${text}`);
}

/** Top level failure line for an expected error. Goes to stderr by default. */
export function errorLine(message, fix = "", { stream = process.stderr } = {}) {
  stream.write(`\n  ${style.red("error")} ${message}\n`);
  if (fix) stream.write(`        ${style.dim("fix:")} ${code(fix)}\n`);
}

export function truncate(text, width) {
  const value = String(text ?? "");
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}\u2026`;
}

export function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `$${number.toFixed(2)}`;
}

/** Aligned key/value block. `pairs` is [key, value, extra?][]. */
export function kv(pairs, { indent = 2 } = {}) {
  const width = pairs.reduce((max, [key]) => Math.max(max, String(key).length), 0);
  for (const [key, value, colour] of pairs) {
    if (value === undefined || value === null || value === "") continue;
    const pad = " ".repeat(width - String(key).length);
    const rendered = colour ? colour(String(value)) : String(value);
    line(`${" ".repeat(indent)}${style.dim(`${key}${pad}`)}  ${rendered}`);
  }
}

/**
 * Table with a 2-space indent.
 * columns: [{ header, key, width?, align?, colour? }], rows: object[]
 */
export function table(columns, rows, { indent = 2 } = {}) {
  const cells = rows.map((row) =>
    columns.map((column) => truncate(row[column.key] ?? "", column.width ?? 40)),
  );
  const widths = columns.map((column, index) =>
    Math.max(String(column.header).length, ...cells.map((row) => row[index].length), 0),
  );
  const pad = " ".repeat(indent);
  const head = columns
    .map((column, index) => {
      const text = String(column.header);
      return column.align === "right" ? text.padStart(widths[index]) : text.padEnd(widths[index]);
    })
    .join("  ");
  line(`${pad}${style.dim(head)}`);
  for (const row of cells) {
    const rendered = row
      .map((value, index) => {
        const column = columns[index];
        const text = column.align === "right" ? value.padStart(widths[index]) : value.padEnd(widths[index]);
        return column.colour ? column.colour(text) : text;
      })
      .join("  ");
    line(`${pad}${rendered}`);
  }
}

/** LCS based line diff, returned as [" ", "-", "+"][]. */
function diffEntries(aText, bText) {
  const a = String(aText).split("\n");
  const b = String(bText).split("\n");
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([" ", a[i]]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(["-", a[i]]);
      i += 1;
    } else {
      out.push(["+", b[j]]);
      j += 1;
    }
  }
  while (i < n) out.push(["-", a[i++]]);
  while (j < m) out.push(["+", b[j++]]);
  return out;
}

/**
 * Unified-style diff for the "we did not overwrite your file" notice.
 * Long runs of unchanged lines collapse to a single marker.
 */
export function renderDiff(aText, bText, { labelA = "existing", labelB = "would-be", context = 2, max = 40 } = {}) {
  const entries = diffEntries(aText, bText);
  const keep = new Array(entries.length).fill(false);
  entries.forEach((entry, index) => {
    if (entry[0] === " ") return;
    for (let k = Math.max(0, index - context); k <= Math.min(entries.length - 1, index + context); k += 1) {
      keep[k] = true;
    }
  });
  const out = [`    ${style.dim(`--- ${labelA}`)}`, `    ${style.dim(`+++ ${labelB}`)}`];
  let hidden = 0;
  let printed = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const [mark, text] = entries[index];
    if (!keep[index]) {
      hidden += 1;
      continue;
    }
    if (hidden > 0) {
      out.push(`    ${style.dim(`  \u2026 ${hidden} unchanged line(s)`)}`);
      hidden = 0;
    }
    if (printed >= max) {
      out.push(`    ${style.dim("  \u2026 diff truncated")}`);
      break;
    }
    const body = mark === "-" ? style.red(text) : mark === "+" ? style.green(text) : style.dim(text);
    out.push(`    ${mark} ${body}`);
    printed += 1;
  }
  for (const row of out) line(row);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Read one visible line from stdin (used for "pick a project by number"). */
export async function ask(question, { defaultValue = "" } = {}) {
  process.stdout.write(question);
  if (!process.stdin.isTTY) process.stdout.write("\n");
  const answer = await readLine();
  if (!answer) return defaultValue;
  return answer;
}

function readLine() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buffer = "";
    const finish = (value) => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      if (stdin.isTTY) stdin.pause();
      resolve(value.trim());
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const index = buffer.search(/[\r\n]/);
      if (index >= 0) finish(buffer.slice(0, index));
    };
    const onEnd = () => finish(buffer);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    if (stdin.isTTY) stdin.resume();
  });
}

/** Read a secret (token) without echoing it. Works with a pipe too. */
export async function readSecret(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    process.stdout.write(`${question}\n`);
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0].trim();
  }
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  let value = "";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    stdin.on("data", onData);
  });
}
