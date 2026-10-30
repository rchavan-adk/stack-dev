/**
 * Miracle standards blocker, in-loop.
 *
 * OpenCode-shaped plugin: exports hooks the executor calls before a tool runs and
 * before a prompt leaves the machine. Agents without a plugin API lose only this
 * layer; commits, pushes, CI and the gateway still enforce the same rules.
 */

const SECRET_SHAPES = [
  /sk-[A-Za-z0-9]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /stk_(dev|lead|adm)_[A-Za-z0-9_-]{16,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

function readConfig(env) {
  return {
    gatewayUrl: env.STACK_GATEWAY_URL ?? "",
    item: env.STACK_ITEM ?? "",
    protectedBranches: (env.STACK_PROTECTED_BRANCHES ?? "main,master,release").split(","),
  };
}

export default function miracleGatewayOnly({ env = process.env } = {}) {
  const config = readConfig(env);

  return {
    name: "miracle-gateway-only",

    /** Refuse a session that is not tied to a claimed item. */
    async onSessionStart() {
      if (!config.item) {
        throw new Error(
          "Miracle harness: no claimed item in this session. Run `stack claim STACK-123` first.",
        );
      }
    },

    /** Block model traffic that does not go through the engagement gateway. */
    async onModelRequest(request) {
      const url = String(request?.baseUrl ?? request?.url ?? "");
      if (!config.gatewayUrl) {
        throw new Error("Miracle harness: no gateway configured in stack.toml.");
      }
      if (url && !url.startsWith(config.gatewayUrl)) {
        throw new Error(
          `Miracle harness: model calls must go through ${config.gatewayUrl}, got ${url}.`,
        );
      }
      return request;
    },

    /** Strip secret-shaped strings before any prompt leaves the machine. */
    async onPromptBuilt(prompt) {
      let text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
      for (const shape of SECRET_SHAPES) {
        text = text.replace(shape, "[redacted-by-miracle-harness]");
      }
      return text;
    },

    /** Last line of defence inside the tool loop. */
    async onToolCall(tool) {
      const command = String(tool?.input?.command ?? "");
      if (/git\s+(commit|push)[^\n]*--no-verify/.test(command)) {
        throw new Error("Miracle harness: --no-verify is not allowed; the remote rejects it anyway.");
      }
      if (/git\s+push[^\n]*--force(-with-lease)?\b/.test(command)) {
        throw new Error("Miracle harness: force pushing a shared branch is blocked.");
      }
      for (const branch of config.protectedBranches) {
        if (new RegExp(`git\\s+push\\s+\\S+\\s+${branch.trim()}\\b`).test(command)) {
          throw new Error(`Miracle harness: direct pushes to ${branch.trim()} are blocked.`);
        }
      }
      return tool;
    },
  };
}
