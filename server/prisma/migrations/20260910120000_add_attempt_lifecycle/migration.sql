-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- AlterTable: per-exam retake cap (null = unlimited, default 1)
ALTER TABLE "exams" ADD COLUMN "maxAttempts" INTEGER DEFAULT 1;

-- AlterTable: attempt lifecycle columns
ALTER TABLE "exam_attempts" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "exam_attempts" ADD COLUMN "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS';
ALTER TABLE "exam_attempts" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "exam_attempts" ADD COLUMN "score" INTEGER;

-- Backfill: a legacy attempt with at least one submission for that
-- (exam, student) is treated as a finished attempt — status SUBMITTED, score =
-- sum of the latest-per-task submission scores, submittedAt = latest of them.
-- Attempts with no submissions stay IN_PROGRESS.
UPDATE "exam_attempts" ea
SET "status" = 'SUBMITTED',
    "submittedAt" = agg.last_at,
    "score" = agg.total
FROM (
  SELECT latest."examId",
         latest."studentId",
         MAX(latest."submittedAt") AS last_at,
         SUM(latest."score")       AS total
  FROM (
    SELECT DISTINCT ON ("examId", "studentId", "taskId")
           "examId", "studentId", "taskId", "score", "submittedAt"
    FROM "submissions"
    ORDER BY "examId", "studentId", "taskId", "submittedAt" DESC
  ) latest
  GROUP BY latest."examId", latest."studentId"
) agg
WHERE ea."examId" = agg."examId" AND ea."studentId" = agg."studentId";

-- Swap the (exam, student) unique for (exam, student, attemptNumber)
DROP INDEX "exam_attempts_examId_studentId_key";
CREATE UNIQUE INDEX "exam_attempts_examId_studentId_attemptNumber_key" ON "exam_attempts"("examId", "studentId", "attemptNumber");
CREATE INDEX "exam_attempts_examId_studentId_idx" ON "exam_attempts"("examId", "studentId");

-- AlterTable: link each submission to its attempt
ALTER TABLE "submissions" ADD COLUMN "attemptId" TEXT;
CREATE INDEX "submissions_attemptId_idx" ON "submissions"("attemptId");

-- Backfill: there is at most one legacy attempt per (exam, student).
UPDATE "submissions" s
SET "attemptId" = ea."id"
FROM "exam_attempts" ea
WHERE ea."examId" = s."examId" AND ea."studentId" = s."studentId";

-- CreateTable: per-attempt, per-task in-progress draft
CREATE TABLE "task_drafts" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "keystrokeCount" INTEGER NOT NULL DEFAULT 0,
    "pasteCount" INTEGER NOT NULL DEFAULT 0,
    "pastedCharCount" INTEGER NOT NULL DEFAULT 0,
    "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_drafts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_drafts_attemptId_taskId_key" ON "task_drafts"("attemptId", "taskId");
CREATE INDEX "task_drafts_taskId_idx" ON "task_drafts"("taskId");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_drafts" ADD CONSTRAINT "task_drafts_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_drafts" ADD CONSTRAINT "task_drafts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
