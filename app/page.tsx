export default function Home() {
  const useMocks = process.env.USE_MOCKS !== "false";
  const mode = useMocks ? "MOCKS" : "LIVE Delever API";

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "64px 24px",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: 36, marginBottom: 8 }}>Delever MCP Bridge</h1>
      <p style={{ opacity: 0.75, marginTop: 0 }}>
        Streamable HTTP MCP server that exposes Delever ordering tools to
        Claude.
      </p>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>Status</h2>
        <ul>
          <li>
            Mode: <strong>{mode}</strong>
          </li>
          <li>
            MCP endpoint: <code>/api/mcp</code>
          </li>
          <li>
            SSE endpoint (legacy clients): <code>/api/sse</code>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>Connect to Claude</h2>
        <p>
          In Claude.ai go to Settings → Connectors → Add custom connector and
          paste the URL of this deployment with <code>/api/mcp</code> appended.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>Tools exposed</h2>
        <ul>
          <li>
            <code>search_restaurants</code>
          </li>
          <li>
            <code>get_menu</code>
          </li>
          <li>
            <code>create_order</code>
          </li>
          <li>
            <code>get_order_status</code>
          </li>
          <li>
            <code>cancel_order</code>
          </li>
        </ul>
      </section>
    </main>
  );
}
