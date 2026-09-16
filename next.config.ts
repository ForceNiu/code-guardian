import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma 与 Babel 在运行时按 node 原生模块加载，禁止打包进 server bundle
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@babel/parser", "@babel/traverse"],
  // Next 16 dev 下 127.0.0.1 访问需放行，否则 HMR 被拦导致 hydration 不完整
  allowedDevOrigins: ["127.0.0.1"],
  // 🔴 显式锁定项目根（2026-09-16 修）。
  // 本仓库的**父目录**（即本仓库所在工作区的上一层）另有一个 package-lock.json，
  // Next 会据此把构建根/追踪根推断到父目录，于是每次 `npm start` / `next build` 都刷一句
  //   ⚠ Warning: Next.js ignored package-lock.json in <父目录> because it is outside the current Git repository
  // 除了噪音，**这条警告还会把本机绝对路径原样写进服务日志**（属公开仓库要防的「本地元数据」）。
  // 显式指定根即可同时消除这两点。
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
