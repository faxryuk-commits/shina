# Delever MCP Bridge

MCP server that bridges AI agents (Claude Desktop, Claude.ai, Cursor, Windsurf)
to the [Delever](https://delever.gitbook.io/delever/for-developers/dlya-integratorov-v2)
ordering API V2.

After connecting this server as a custom connector, a user can chat with Claude
in plain language ("закажи плов с доставкой на Навои 25, оплата картой") and
Claude will call the right tools to search restaurants, fetch menus, place an
order and track its status — without leaving the chat.

> Status: MVP. Runs on mock data by default. Flip a single environment variable
> to switch to the real Delever API once you receive credentials.

See sections below for full instructions.

## Tech stack

- Next.js 15 (App Router) deployed on Vercel
- [`mcp-handler`](https://github.com/vercel/mcp-adapter) — Streamable HTTP MCP
  adapter
- `@modelcontextprotocol/sdk` 1.29
- `zod` for tool input validation
- TypeScript

No database. No Redis. Stateless serverless functions.

## Project structure

```
app/
  layout.tsx                  Next.js root layout
  page.tsx                    Status landing page
  api/[transport]/route.ts    MCP endpoint (handles /api/mcp and /api/sse)
lib/
  mockData.ts                 In-memory restaurants/menus/stop list
  deleverAuth.ts              OAuth client_credentials with token cache
  deleverClient.ts            Real-API + mock-fallback wrapper
.env.example                  All environment variables documented
vercel.json                   Vercel function config (maxDuration: 60s)
```

## Local development

Requires Node.js 20+.

```bash
git clone <your-fork-url>
cd Шина
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the status
page with `Mode: MOCKS`. The MCP endpoint is at
[http://localhost:3000/api/mcp](http://localhost:3000/api/mcp).

### Sanity check the MCP endpoint locally

These five `curl` calls exercise the full happy path on mock data. Run them
against `http://localhost:3000/api/mcp` while `npm run dev` is up:

```bash
# 1. Initialize (server returns capabilities)
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# 2. List exposed tools
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3. Search restaurants
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_restaurants","arguments":{"query":"plov"}}}'

# 4. Place an order (use ids returned by step 3 + a get_menu call)
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_order","arguments":{"restaurant_id":"rst_plov_center","items":[{"item_id":"dish_plov_classic","quantity":2,"modifier_ids":["mod_size_large","mod_meat_lamb"]}],"delivery":{"name":"Faxriddin","phone":"+998901234567","address":"Navoi 25","lat":41.31,"lng":69.24},"payment":"CARD"}}}'
```

The responses come back as Server-Sent Events (`event: message\ndata: ...`)
because MCP Streamable HTTP allows servers to stream multiple messages per
request. Your client (Claude) handles this transparently.

## Deploy to Vercel

1. Create a new GitHub repository and push this code.

   ```bash
   git init
   git add .
   git commit -m "Initial commit: Delever MCP bridge MVP"
   git branch -M main
   git remote add origin git@github.com:<you>/delever-mcp-bridge.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com), click *New Project*, import the
   repository. Vercel auto-detects Next.js.

3. Under *Environment Variables* add:

   | Name | Value |
   | --- | --- |
   | `USE_MOCKS` | `true` |

   That is enough to deploy. The mock dataset includes three Tashkent
   restaurants with full menus on ru/en/uz.

4. Click *Deploy*. After the build finishes you get a URL like
   `https://delever-mcp-bridge.vercel.app`.

5. Verify the MCP endpoint responds:

   ```bash
   curl -i https://<your-deployment>.vercel.app/api/mcp \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
   ```

   You should get a JSON-RPC `result` describing the server's capabilities.

## Switching to the real Delever API

The Delever public docs at
<https://delever.gitbook.io/delever/for-developers/dlya-integratorov-v2>
specify endpoints as **relative paths** with `servers: [{ "url": "/" }]` —
they don't publish a hostname. The actual production gateway (verified
empirically) is **`https://integrator.api.delever.uz`**.

In Vercel → *Settings* → *Environment Variables* set:

| Name | Value |
| --- | --- |
| `USE_MOCKS` | `false` |
| `DELEVER_BASE_URL` | `https://integrator.api.delever.uz` |
| `DELEVER_CLIENT_ID` | UUID issued by Delever |
| `DELEVER_CLIENT_SECRET` | base64-encoded `<username>:<password>` |

A note on the credentials mapping: in the chat Delever sometimes labels the
two values the other way round. Empirically the OAuth endpoint accepts the
spec-aligned mapping above (UUID → `client_id`, base64 → `client_secret`)
and rejects the swapped form with `401 invalid client secret`.

Optionally `DELEVER_OAUTH_PATH` if their token endpoint ever moves off
`/v1/custom-integration/security/oauth/token`.

Redeploy. No code changes required.

## Connect to Claude.ai

1. Go to Claude.ai → *Settings* → *Connectors* → *Add custom connector*.
2. Paste the URL: `https://<your-deployment>.vercel.app/api/mcp`.
3. Save and enable the connector.
4. In any chat, ask Claude something like:
   - "Find Tashkent restaurants serving plov."
   - "Order two plates of plov from Plov Center, deliver to Navoi 25, pay by
     card. My phone is +998 90 123 45 67, name Faxriddin."
   - "Check the status of my last order."

Claude figures out which tools to call and chains them automatically.

## Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "delever": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<your-deployment>.vercel.app/api/mcp"
      ]
    }
  }
}
```

`mcp-remote` is required because Claude Desktop only speaks stdio MCP — it acts
as a bridge to our remote HTTP endpoint.

## MCP tools exposed

All tools accept JSON arguments validated with `zod`. The full schema is
declared in
[`app/api/[transport]/route.ts`](app/api/%5Btransport%5D/route.ts).

### `search_restaurants`

Find restaurants currently available for ordering.

```json
{
  "query": "plov",
  "only_available": true
}
```

Both fields are optional. Returns a list of restaurants with `id`, `name`,
`address`, coordinates and `online` status.

Backed by `GET /restaurants` + `GET /restaurants/availability`.

### `get_menu`

Fetch the menu for a single restaurant. Categories, dishes, prices, modifiers
and stop list are all merged in the response.

```json
{
  "restaurant_id": "rst_001",
  "language": "ru"
}
```

`language` is optional, one of `ru | en | uz`. Defaults to `ru`.

Backed by `GET /menu/{restaurantId}/composition` +
`GET /menu/{restaurantId}/availability`.

### `create_order`

Place a new order on the restaurant's POS.

```json
{
  "restaurant_id": "rst_001",
  "items": [
    {
      "item_id": "dish_plov_classic",
      "quantity": 2,
      "modifier_ids": ["mod_size_large"]
    }
  ],
  "delivery": {
    "name": "Faxriddin",
    "phone": "+998901234567",
    "address": "Navoi 25, Tashkent",
    "lat": 41.311081,
    "lng": 69.240562
  },
  "payment": "CARD",
  "comment": "Please ring the doorbell."
}
```

Returns `{ "order_id": "..." }`.

Backed by `POST /order` with `discriminator: "aggregator"`.

### `get_order_status`

```json
{ "order_id": "ord_xxx" }
```

Returns `{ "status": "ACCEPTED" | "COOKING" | "TAKEN_BY_COURIER" | "DELIVERED" | "CANCELLED" }`.

Backed by `GET /order/{orderId}/status`.

### `cancel_order`

```json
{ "order_id": "ord_xxx", "reason": "Changed my mind" }
```

Backed by `DELETE /order/{orderId}`.

### `get_order`

Fetch the full order — items, delivery details, payment info and totals.
Heavier than `get_order_status`; use it only when you need the body.

```json
{ "order_id": "ord_xxx" }
```

Backed by `GET /order/{orderId}` (response in `application/vnd.eats.order.v2+json`).

### `update_order_status`

Push a status update for an existing order. Useful for integrating courier or
POS state-machine signals. Prefer `cancel_order` for user-initiated
cancellations.

```json
{
  "order_id": "ord_xxx",
  "status": "TAKEN_BY_COURIER",
  "comment": "Courier picked up at 19:42"
}
```

Allowed statuses: `DELIVERED`, `TAKEN_BY_COURIER`, `CANCELLED`.

Backed by `PUT /order/{orderId}/status` (returns 204 No Content).

### `list_promo_items`

Return menu items currently participating in promotional campaigns.

```json
{ "restaurant_id": "rst_001" }
```

Returns `{ "restaurant_id": "rst_001", "items": [{ "id": "...", "promo_id": "..." }] }`.

Backed by `GET /menu/{restaurantId}/promos`.

## Known issues

### `inputSchema as any` casts in the MCP route

The route file deliberately casts each tool's `inputSchema` to `any`. This is
the upstream-recommended workaround for
[modelcontextprotocol/typescript-sdk#985](https://github.com/modelcontextprotocol/typescript-sdk/issues/985)
("Type instantiation is excessively deep") which is hit when `registerTool` is
called with multiple `.optional()` Zod fields. The cast has zero runtime
effect (the SDK normalizes the raw shape on its end). Callback parameter
types are restated as standalone TS interfaces so we keep type safety inside
each handler. Once the SDK fixes the inference issue, the casts can be
deleted in one pass.

### Mock orders reset on cold start

Mock mode keeps placed orders in a `Map` inside the lambda's memory. Once the
lambda goes cold, mock orders disappear. This is intentional for the MVP — in
real (`USE_MOCKS=false`) mode, Delever owns the persistence.

### Delever caps `GET /restaurants` at 10 entries

Empirically (verified 2026-04-29 against `integrator.api.delever.uz`), the
public V2 endpoint `GET /v1/custom-integration/restaurants` returns at most
10 places, and **none** of `?limit=`, `?offset=`, `?page=`, `?page_size=` or
`?cursor=` change the response. The companion endpoint
`GET /v1/custom-integration/restaurants/availability` returns the **full**
list of branches (id + enabled), and the menu / order endpoints work for
every branch — only branch _details_ (title, address, coordinates) are gated.

`searchRestaurants` works around this by treating `availability` as the
authoritative branch list and merging in `/restaurants` details when present.
Branches outside the first 10 are returned with `details_available: false`,
empty `name`/`address` and zeroed coordinates. The home page renders such
cards with a yellow tint and the explanation "Details unavailable via API V2
— Delever's GET /restaurants caps at 10."

If your account has more than 10 branches, ask Delever support to lift this
server-side cap (referencing the OpenAPI spec, which does not document any
limit).

## TODO / next iterations

- OpenAPI spec + Custom GPT for ChatGPT (mirrors the same eight tools)
- OAuth or shared-secret auth on the MCP endpoint itself (currently public)
- Telegram mini-app frontend that uses the same Delever client
- Persist Delever OAuth token + monitor ring buffer across cold starts
  (Upstash Redis or Vercel KV) — both are in-process today
- Push of order status updates to the user (polling on the client side for now)
- `update_order` (PUT `/order/{orderId}`) is not yet exposed — add when
  Delever clarifies the practical use case (e.g. add items mid-flight)

## License

Private / WIP.
