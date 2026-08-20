import { withSerwist } from "@serwist/turbopack";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // PnP zip paths live outside the project dir; pin the root so Turbopack
  // does not mis-infer it (yarn berry + Windows).
  turbopack: {
    root: process.cwd(),
  },
  transpilePackages: ["onnxruntime-web"],
  images: {
    dangerouslyAllowSVG: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default withSerwist(nextConfig);
