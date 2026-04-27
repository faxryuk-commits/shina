/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@modelcontextprotocol/sdk", "mcp-handler"],
};

export default nextConfig;
