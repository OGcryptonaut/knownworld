import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone", // self-contained server for the Cloud Run image (web/Dockerfile)
};

export default nextConfig;
