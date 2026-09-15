import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type {
  SymbolTableEntry,
  SymbolCache,
  SymbolInfo,
  ImportInfo,
  ReexportInfo,
} from "./types";

/**
 * 把 Worker 算出的符号表持久化到 file_snapshots（哈希缓存 + 解析缓存）+ export_symbols（反向索引）。
 * 每次分析后按文件整体刷新：哈希命中即可作为下次增量跳过解析的依据。
 *
 * 一致性：三段写入放在**同一事务**里，避免「旧符号已删、新符号未写完」的中间态。
 * 性能：export_symbols 的删除 / 写入按**整批一次**完成（原实现每个文件各来一次 → 3N 次往返）。
 */
export async function persistSymbolTable(repoId: string, symbolTable: SymbolTableEntry[]) {
  if (symbolTable.length === 0) return;

  const filePaths = symbolTable.map((e) => e.filePath);
  const symbolRows = symbolTable.flatMap((entry) =>
    entry.symbols.map((s) => ({
      repoId,
      filePath: entry.filePath,
      symbolName: s.name,
      symbolType: s.type,
      importers: s.importers,
    })),
  );

  await prisma.$transaction(
    async (tx) => {
      // 1) 反向索引：整批删掉本次涉及文件的旧符号（一次往返）
      await tx.exportSymbol.deleteMany({ where: { repoId, filePath: { in: filePaths } } });

      // 2) 整批写入新符号（一次往返）
      if (symbolRows.length > 0) {
        await tx.exportSymbol.createMany({ data: symbolRows });
      }

      // 3) 文件快照 upsert（Prisma 无批量 upsert，逐文件但在同一事务内）
      for (const entry of symbolTable) {
        const symbols = {
          exports: entry.exports,
          imports: entry.imports,
          reexports: entry.reexports,
        } as unknown as Prisma.InputJsonValue;

        await tx.fileSnapshot.upsert({
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
      }
    },
    { timeout: 30000 }, // 大仓库文件多时给足事务时间
  );
}

/**
 * 读某仓库的增量缓存：file_snapshots 里的 contentHash + 解析结果（exports/imports/reexports）。
 * 供 worker 在下次分析时复用——未变更文件命中哈希即可跳过 parse。
 */
export async function readSymbolCache(repoId: string): Promise<SymbolCache> {
  const snapshots = await prisma.fileSnapshot.findMany({ where: { repoId } });
  const hashByFile: Record<string, string> = {};
  const exportsByFile: Record<string, SymbolInfo[]> = {};
  const importsByFile: Record<string, ImportInfo[]> = {};
  const reexportsByFile: Record<string, ReexportInfo[]> = {};

  for (const snap of snapshots) {
    hashByFile[snap.filePath] = snap.contentHash;
    if (snap.symbols) {
      const cached = snap.symbols as unknown as {
        exports?: SymbolInfo[];
        imports?: ImportInfo[];
        reexports?: ReexportInfo[];
      };
      if (Array.isArray(cached.exports)) exportsByFile[snap.filePath] = cached.exports;
      if (Array.isArray(cached.imports)) importsByFile[snap.filePath] = cached.imports;
      if (Array.isArray(cached.reexports)) reexportsByFile[snap.filePath] = cached.reexports;
    }
  }

  return { hashByFile, exportsByFile, importsByFile, reexportsByFile };
}
