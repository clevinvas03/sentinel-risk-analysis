/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // jsdom (used by the fetch_url tool) and pg are Node-only deps; keep them
    // external so Next does not try to bundle them into the server build.
    serverComponentsExternalPackages: ["jsdom", "@mozilla/readability", "pg"],
  },
};

export default nextConfig;
