/**
 * Error types shared by every command.
 *
 * The CLI never prints a stack trace for an expected failure: it prints the
 * message and, when we know it, the exact command that fixes the problem.
 */

/** An expected failure: exit 1, message plus an optional fixing command. */
export class CliError extends Error {
  constructor(message, { fix = "", exitCode = 1, detail = "", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CliError";
    this.fix = fix;
    this.detail = detail;
    this.exitCode = exitCode;
    this.expected = true;
  }
}

/** Wrong usage: exit 2. */
export class UsageError extends CliError {
  constructor(message, opts = {}) {
    super(message, { ...opts, exitCode: 2 });
    this.name = "UsageError";
  }
}

/** The portal answered, but with a failure status. */
export class ApiError extends CliError {
  constructor(message, { status = 0, body = null, url = "", fix = "", detail = "" } = {}) {
    super(message, { fix, detail });
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.url = url;
  }

  /** The portal's own words, when it sent a body we can read. */
  get portalMessage() {
    if (this.body && typeof this.body === "object") {
      if (typeof this.body.error === "string" && this.body.error) return this.body.error;
      if (typeof this.body.message === "string" && this.body.message) return this.body.message;
    }
    if (typeof this.body === "string" && this.body.trim()) return this.body.trim();
    return "";
  }
}
