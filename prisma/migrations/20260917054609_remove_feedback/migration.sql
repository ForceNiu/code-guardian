/*
  Warnings:

  - You are about to drop the `feedbacks` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "feedbacks" DROP CONSTRAINT "feedbacks_task_id_fkey";

-- DropTable
DROP TABLE "feedbacks";

-- DropEnum
DROP TYPE "FeedbackAction";
