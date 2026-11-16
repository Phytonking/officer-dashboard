# MCP agents

Every officer can connect their own AI agent (Claude Code, Claude, Cursor, ChatGPT, or any
MCP client) to the dashboard and have it do real work: plan events, file purchase requests
and receipts, move design cards, log outreach, run finance reports.

There is one endpoint, `https://<dashboard>/mcp`. The agent signs in **as the officer** with
OAuth, so it can do exactly what that officer can do in the UI, nothing more.

## Connecting

```sh
claude mcp add --transport http cseed https://<dashboard>/mcp
```

In Claude, Cursor or ChatGPT, add the same URL as a custom connector / MCP server. The
browser opens the dashboard; sign in with Discord if asked, then choose **Allow**.
Settings → Connected agents shows the URL, the command, and every connected agent with a
**Disconnect** button.

## How it works

```
agent ── POST /mcp (no token) ─────────────────────▶ 401 WWW-Authenticate: resource_metadata=…
agent ── GET /.well-known/oauth-protected-resource ─▶ authorization server = the dashboard
agent ── GET /.well-known/oauth-authorization-server
agent ── POST /oauth/register (RFC 7591, public client) ─▶ client_id
browser ─ GET /oauth/authorize (PKCE S256 required)
            signed out → /login?next=… (Discord) → back here
            consent page: "Allow <agent> to work in the dashboard as you?" → Allow
          ─▶ redirect_uri?code=…&state=…&iss=…
agent ── POST /oauth/token ─▶ access token (1 h) + refresh token (30 days, rotates on use)
agent ── POST /mcp  Authorization: Bearer … ─▶ tools
```

- **Same permissions as the UI.** A tool call becomes an in-process request to the existing
  API route, run through the normal auth middleware with the officer as the principal. Every
  role check, validation rule, lifecycle rule (no self-approval, payout tolerance, …) and
  onboarding gate applies unchanged. `tools/list` hides tools above the officer's role.
- **Audit.** Every change is recorded as the officer, with the agent's grant in
  `audit_log.actor_agent_id`; the audit log shows "Priya Shah via Claude Code".
  Connecting is logged as `agent.connected`, disconnecting as `agent.disconnected`.
- **Revocation.** The user is reloaded on every call: deactivation stops the agent at once,
  and also revokes all of the officer's grants (with their sessions). Role changes apply on
  the next call. Officers disconnect agents from Settings.
- **Storage.** Only SHA-256 hashes of codes and tokens are stored (`oauth_clients`,
  `oauth_codes`, `oauth_grants`). Codes are single use (burned even by a failed attempt) and
  live 2 minutes.
- **Redirect URIs.** https, http on a loopback host (any port, RFC 8252), or an app scheme
  such as `cursor://`. Never `javascript:`, `data:` or `file:`. A request with an
  unregistered redirect URI gets an error page, never a redirect.
- **Transport.** Streamable HTTP, stateless: each POST carries a JSON-RPC message or batch
  and gets a JSON reply. No SSE stream, no sessions (`GET /mcp` is 405). CORS is open on the
  bearer-only endpoints (no cookies are accepted there).
- **Rate limits.** POSTs to `/oauth/*` share the sign-in budget per IP.

## Tools

About 70 tools, one per API endpoint: context (`whoami`, `search`, `lookups`,
`calendar_feed`…), events, purchase requests (including `attach_receipt` with base64
files), finance reports and budgets, the design board, external contacts, members,
officers and invites, Buildspace Launchpad and the officer's own profile. Deletes and
period closes are marked `destructiveHint` so clients ask before running them.

Not exposed: sign-in and onboarding, Google Calendar connection, file downloads,
`/api/admin/*` (owners, roles, accounts, service tokens: an agent never manages access
or credentials), the service-token APIs and Cloudflare sync.

Tool names, descriptions and the endpoint list live in `scripts/gen-mcp-tools.mjs`; the
input schemas come from `src/core/contracts.ts`. After changing either, regenerate:

```sh
npm run mcp-tools        # writes server/internal/api/mcp_tools.json (embedded in the binary)
```

CI runs `node scripts/gen-mcp-tools.mjs --check`, and `TestMCPToolsMatchRoutes` fails if a
tool points at a route that does not exist.

## Deployment

Behind Cloudflare Tunnel / Access or another proxy, let `/mcp`, `/oauth/*` and
`/.well-known/oauth-*` through without a browser challenge, and set `APP_URL` to the public
origin (the metadata URLs are built from it).

## Trying it locally

```sh
cd server && make dev                       # seeded server on :8090 with dev sign-in
claude mcp add --transport http cseed-local http://localhost:8090/mcp
```

The consent flow uses the normal login page, so the dev sign-in panel works there too.
