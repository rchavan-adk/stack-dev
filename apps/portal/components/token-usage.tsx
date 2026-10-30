import { CopyButton } from "./copy-button";

/**
 * The two ways a token is used: the OpenCode remote MCP entry (Authorization
 * header) and the CLI login. Both snippets are copy-ready apart from the token.
 */
export function TokenUsage({ portalUrl, mcpUrl }: { portalUrl: string; mcpUrl: string }) {
  const opencode = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        stack: {
          type: "remote",
          url: mcpUrl,
          enabled: true,
          headers: { Authorization: "Bearer stk_dev_…" },
        },
      },
    },
    null,
    2,
  );

  const login = `stack login --token stk_dev_… --portal ${portalUrl}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-2">
          <h3 className="card-title text-sm">OpenCode · remote MCP</h3>
          <p className="text-xs text-base-content/60">
            The Authorization header authenticates every tool call. <code className="stack-mono">stack mcp install --agent opencode</code>{" "}
            writes this entry into <code className="stack-mono">opencode.json</code> with the real
            token embedded.
          </p>
          <div className="mockup-code text-xs">
            <pre>
              <code>{opencode}</code>
            </pre>
          </div>
          <CopyButton text={opencode} label="Copy JSON" />
        </div>
      </div>

      <div className="card border border-base-300 bg-base-100">
        <div className="card-body gap-2">
          <h3 className="card-title text-sm">Stack CLI</h3>
          <p className="text-xs text-base-content/60">
            The CLI stores the token in{" "}
            <code className="stack-mono">~/.stack/credentials.json</code> (mode 0600) and sends it as
            a Bearer token to the portal.
          </p>
          <div className="mockup-code text-xs">
            <pre data-prefix="$">
              <code>stack login --token stk_dev_…</code>
            </pre>
            <pre data-prefix="$">
              <code>stack login --token stk_dev_… --portal {portalUrl}</code>
            </pre>
          </div>
          <CopyButton text={login} />
        </div>
      </div>
    </div>
  );
}
