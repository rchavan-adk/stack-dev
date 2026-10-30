# stack-ai

The `stack` CLI for the [Stack AI](https://github.com/rchavan-adk/stack-dev)
delivery system of record.

Stack AI holds the templates every issue must match, the approvals only humans
can give, and the evidence behind every status change. This CLI is what a
developer runs on their own machine to link a repository, install the versioned
harness pack, claim work, and check their setup.

## Install

```bash
npm i -g stack-ai
```

Requires Node 20 or newer.

## Use

```bash
stack login                       # paste a portal token (https://<portal>/settings/tokens)
stack whoami                      # who the token says you are

stack project detect              # register/link the repo you are in
stack link <KEY>                  # ...or link a project directly by key

stack harness install             # download, verify and install the harness pack
stack harness status              # what is installed vs what the portal publishes
stack mcp install --agent opencode

stack issues --mine               # your assigned work
stack claim STACK-101             # claim an item; sets the session item

stack doctor                      # 7-point setup check with exact fixes
stack verify                      # run the pack's verification script
```

Commits whose message carries no item handle (`STACK-101: ...`) are rejected by
the installed git hooks, and again by the server.

## Configuration

Everything lives under `~/.stack/` (override with `STACK_HOME`):

- `credentials.json` — portal URL + token, mode 0600
- `<repo>/.stack/project.json` — the project link, written by `stack project detect`
- `<repo>/.stack/pack/` — the extracted, checksum-verified harness pack

`--portal <url>` overrides the portal for any command; `STACK_PORTAL_URL` and
`STACK_MCP_URL` work as environment variables.

## License

Proprietary — see [LICENSE](./LICENSE). All rights reserved.
