-- CreateEnum
CREATE TYPE "ComparisonMode" AS ENUM ('EXACT', 'TRIM_TRAILING_WS', 'IGNORE_BLANK_LINES', 'FLOAT');

-- AlterTable: optional exam scheduling window
ALTER TABLE "exams" ADD COLUMN "opensAt" TIMESTAMP(3);
ALTER TABLE "exams" ADD COLUMN "closesAt" TIMESTAMP(3);

-- AlterTable: per-task output comparison rule
ALTER TABLE "tasks" ADD COLUMN "comparisonMode" "ComparisonMode" NOT NULL DEFAULT 'EXACT';
ALTER TABLE "tasks" ADD COLUMN "floatTolerance" DOUBLE PRECISION NOT NULL DEFAULT 0.000001;
