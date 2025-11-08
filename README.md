cloudflared --config ~/.cloudflared/config.yml tunnel run whoop-mcp


# WHOOP MCP Server for Poke

This project exposes WHOOP sleep and cycle strain data over the Model Context Protocol (MCP) so that Poke can connect via the legacy HTTP+SSE transport.

## Prerequisites

1. WHOOP developer application with Authorization Code flow enabled.
2. Redirect URL `https://whoop.abhisheksankar.com/oauth/whoop/callback` registered in the WHOOP portal.
3. Client ID and Client Secret from the WHOOP developer dashboard.
4. A public HTTPS endpoint (e.g., whoop.abhisheksankar.com) that will host this server for Poke.

## Setup

```bash
npm install
cp .env.example .env
```

Update `.env` in the project root (do not commit this file):

```
PUBLIC_BASE_URL=
WHOOP_CLIENT_ID=<WHOOP_CLIENT_ID>
WHOOP_CLIENT_SECRET=<WHOOP_CLIENT_SECRET>
TOKEN_STORE_PATH=./data/whoop-tokens.json
PORT=3000
HOST=0.0.0.0
# Optional: require an API key for MCP requests
# MCP_API_KEY=generate-a-strong-key
# Optional: override default scopes (comma-separated)
# WHOOP_SCOPES=read:sleep,read:cycles,read:profile
```

## Running locally

```bash
npm run dev
```

Open `http://localhost:3000/oauth/whoop/login` in a browser to start the WHOOP OAuth flow, sign in, and approve scopes.

The server exposes:

- `POST /sse` and `GET /sse` — MCP transport endpoints used by Poke.
- `GET /oauth/whoop/login` — starts OAuth flow (supports `?key=` and `?next=`).
- `GET /oauth/whoop/callback` — OAuth redirect handler (automatic).
- `GET /healthz` — basic readiness check.

## Deploying

Deploy the server behind HTTPS at `https://whoop.abhisheksankar.com`. Update `.env` with the real base URL and restart the service. Ensure port 3000 (or your chosen port) is accessible.

## Poke configuration

If you set `MCP_API_KEY`, send the same value in the `Authorization: Bearer <key>` header (Poke’s UI accepts the key field and will forward it as `Authorization`).

In Poke’s “New Integration” form:

- **Name**: WHOOP (or anything meaningful)
- **Server URL**: `https://whoop.abhisheksankar.com/sse`
- **API Key**: enter the value from `MCP_API_KEY` (leave blank only if you didn’t set one)

## Available tools

1. `whoop_sleep_recent` — returns recent sleep sessions with duration and WHOOP sleep performance. Optional inputs: `limit`, `start`, `end`, `nextToken`, `key` (for multi-user token storage).
2. `whoop_cycle_strain` — returns cycle summaries including strain (stress) and heart-rate metrics. Same optional filters as above.

Both tools return structured content matching the WHOOP pagination payload, plus a plain-text summary for quick inspection.

## REST endpoints

- `GET /metrics/today` — returns an at-a-glance JSON snapshot of today’s WHOOP metrics for the stored token (optionally supply `?key=` for multi-user setups). The payload includes overall sleep duration, stage breakdown, sleep score, strain, and calorie burn (kilojoules converted to kcal). WHOOP’s public API does not expose a daily steps total, so that field is returned as `null` for now.

## Notes

- The server stores one token set per `key` (default is `default`). Add `?key=user123` to `/oauth/whoop/login` to authorize additional accounts.
- No explicit “steps” metric exists in WHOOP v2; cycle strain is exposed as the stress proxy.
- Tokens are automatically refreshed when requests detect expiration (60-second safety buffer).
- The legacy HTTP+SSE transport is maintained via `StreamableHTTPServerTransport`, compatible with Poke’s current expectations.
