-- CreateEnum
CREATE TYPE "ExamMode" AS ENUM ('EXAM', 'PRACTICE');

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "mode" "ExamMode" NOT NULL DEFAULT 'EXAM',
ALTER COLUMN "timeLimitMinutes" DROP NOT NULL;

-- CreateTable
CREATE TABLE "practice_submissions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "code" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "overallStatus" "SubmissionStatus" NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_submissions_taskId_studentId_idx" ON "practice_submissions"("taskId", "studentId");

-- AddForeignKey
ALTER TABLE "practice_submissions" ADD CONSTRAINT "practice_submissions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_submissions" ADD CONSTRAINT "practice_submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
