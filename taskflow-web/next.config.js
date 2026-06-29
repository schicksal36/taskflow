/** @type {import('next').NextConfig} */
const backendPort = process.env.TASKFLOW_BACKEND_PORT || "8000";
const backendUrl = process.env.TASKFLOW_BACKEND_URL || `http://localhost:${backendPort}`;

const nextConfig = {
  images: {
    unoptimized: true,
  },
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*/`,
      },
      {
        source: "/media/:path*",
        destination: `${backendUrl}/media/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
