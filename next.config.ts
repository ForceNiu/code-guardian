import type { NextConfig } from "next";
import MonacoWebpackPlugin from "monaco-editor-webpack-plugin";

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

  // ⚠️ Monaco「本地打包」——2026-09-20 实测**未生效**，此处如实记下，别被标题骗了。
  //    原意（2026-09-17）：靠下面这段 webpack 钩子把 monaco 打进产物，消除 CDN 依赖。
  //    但 dev 与 `next build` 都跑 **Turbopack**，而 Turbopack **不执行 webpack 插件** →
  //    @monaco-editor/react 回落到它默认的 CDN loader：详情页实测发出 15 个站外请求到
  //    `cdn.jsdelivr.net/npm/monaco-editor@0.55.1/...`（连版本都 ≠ package.json 固定的 0.52.2）。
  //    影响：有网时约 20s 才渲染完；**离线 / 内网部署下「代码 Diff」块会一直停在 Loading...**。
  //    决定：**暂不修**（非阻塞，报告主体不依赖它），登记见 docs/AUDIT-BACKLOG.md §三「明确不做」②。
  //    若要修：给 Turbopack 配等效静态资源规则，或用 `loader.config({ monaco })` 喂本地实例，
  //            并补一条产物级断言 —— 构建产物中不得出现 `cdn.jsdelivr.net`。
  //    注：这段钩子保留，是因为若将来切回 webpack 构建它会重新生效；但在 Turbopack 下它是死代码。
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.plugins.push(
        new MonacoWebpackPlugin({
          languages: [
            "typescript",
            "javascript",
            "json",
            "css",
            "scss",
            "less",
            "html",
            "markdown",
            "yaml",
            "python",
          ],
          filename: "static/monaco/[name].worker.js",
        })
      );
    }
    return config;
  },
};

export default nextConfig;
