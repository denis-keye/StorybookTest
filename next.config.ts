import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin',  value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        // Serve the static Storybook build under /storybook
        // (storybook-static/ is output by `npm run build-storybook`)
        source: '/storybook/:path*',
        destination: '/storybook-static/:path*',
      },
    ];
  },
};

export default nextConfig;
