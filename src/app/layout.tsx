import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Code Guardian — AI 代码副作用检测与审查治理平台",
  description: "在 MR 合并前自动分析「这次改动影响了哪些函数、哪些文件」，作为合并门禁依据。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
