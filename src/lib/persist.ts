import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { SymbolTableEntry, SymbolCache, SymbolInfo, ImportInfo } from "./types";

/**
 * 把 Worker 算出的符号表持久化到 file_snapshots（哈希缓存 + 解析缓存）+ export_symbols（反向索引）。
 * 每次分析后按文件整体刷新：哈希命中即可作为下次增量跳过解析的依据。
 */
export async function persistSymbolTable(repoId: string, symbolTable: SymbolTableEntry[]) {
  for (const entry of symbolTable) {
    const symbols = {
      exports: entry.exports,
      imports: entry.imports,
    } as unknown as Prisma.InputJsonValue;

    await prisma.fileSnapshot.upsert({
      where: { repoId_filePath: { repoId, filePath: entry.filePath } },
      create: {
        repoId,
        filePath: entry.filePath,
        contentHash: entry.hash,
        symbols,
      },
      update: {
        contentHash: entry.hash,
        symbols,
      },
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

/**
 * 读某仓库的增量缓存：file_snapshots 里的 contentHash + 解析结果（exports/imports）。
 * 供 worker 在下次分析时复用——未变更文件命中哈希即可跳过 parse。
 */
export async function readSymbolCache(repoId: string): Promise<SymbolCache> {
  const snapshots = await prisma.fileSnapshot.findMany({ where: { repoId } });
  const hashByFile: Record<string, string> = {};
  const exportsByFile: Record<string, SymbolInfo[]> = {};
  const importsByFile: Record<string, ImportInfo[]> = {};

  for (const snap of snapshots) {
    hashByFile[snap.filePath] = snap.contentHash;
    if (snap.symbols) {
      const cached = snap.symbols as unknown as {
        exports?: SymbolInfo[];
        imports?: ImportInfo[];
      };
      if (Array.isArray(cached.exports)) exportsByFile[snap.filePath] = cached.exports;
      if (Array.isArray(cached.imports)) importsByFile[snap.filePath] = cached.imports;
    }
  }

  return { hashByFile, exportsByFile, importsByFile };
}
