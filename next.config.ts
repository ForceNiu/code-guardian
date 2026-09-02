import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma 与 Babel 在运行时按 node 原生模块加载，禁止打包进 server bundle
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@babel/parser", "@babel/traverse"],
  // Next 16 dev 下 127.0.0.1 访问需放行，否则 HMR 被拦导致 hydration 不完整
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
