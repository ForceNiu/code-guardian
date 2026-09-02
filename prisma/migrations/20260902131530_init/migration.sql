-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'parsing', 'analyzing', 'reporting', 'done', 'failed');

-- CreateEnum
CREATE TYPE "FeedbackAction" AS ENUM ('adopt', 'reject', 'false_positive');

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "git_url" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "rules_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "mr_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "base_ref" TEXT NOT NULL DEFAULT '',
    "head_ref" TEXT NOT NULL DEFAULT '',
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_snapshots" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_symbols" (
    "id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "symbol_name" TEXT NOT NULL,
    "symbol_type" TEXT NOT NULL,
    "importers" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_symbols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "action" "FeedbackAction" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_git_url_key" ON "repositories"("git_url");

-- CreateIndex
CREATE INDEX "tasks_status_created_at_idx" ON "tasks"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_repo_id_mr_id_commit_sha_key" ON "tasks"("repo_id", "mr_id", "commit_sha");

-- CreateIndex
CREATE UNIQUE INDEX "file_snapshots_repo_id_file_path_key" ON "file_snapshots"("repo_id", "file_path");

-- CreateIndex
CREATE INDEX "export_symbols_repo_id_symbol_name_idx" ON "export_symbols"("repo_id", "symbol_name");

-- CreateIndex
CREATE UNIQUE INDEX "export_symbols_repo_id_file_path_symbol_name_key" ON "export_symbols"("repo_id", "file_path", "symbol_name");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_snapshots" ADD CONSTRAINT "file_snapshots_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_symbols" ADD CONSTRAINT "export_symbols_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
