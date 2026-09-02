import { prisma } from "./prisma";
import type { SymbolTableEntry } from "./types";

/**
 * 把 Worker 算出的符号表持久化到 file_snapshots（哈希缓存）+ export_symbols（反向索引）。
 * 每次分析后按文件整体刷新：哈希命中即可作为下次增量跳过解析的依据。
 */
export async function persistSymbolTable(repoId: string, symbolTable: SymbolTableEntry[]) {
  for (const entry of symbolTable) {
    await prisma.fileSnapshot.upsert({
      where: { repoId_filePath: { repoId, filePath: entry.filePath } },
      create: { repoId, filePath: entry.filePath, contentHash: entry.hash },
      update: { contentHash: entry.hash },
    });

    // 反向索引按文件重建：先删该文件的旧符号，再写入新符号
    await prisma.exportSymbol.deleteMany({ where: { repoId, filePath: entry.filePath } });
    if (entry.symbols.length > 0) {
      await prisma.exportSymbol.createMany({
        data: entry.symbols.map((s) => ({
          repoId,
          filePath: entry.filePath,
          symbolName: s.name,
          symbolType: s.type,
          importers: s.importers,
        })),
      });
    }
  }
}
