-- One task = one answer language (teacher-chosen; the student has no picker).
-- Reverts the allowedLanguages[] array + task_starter_codes child table from
-- 20260909010000 back to a single tasks.language + tasks.starterCode.

-- AlterTable: single language + single starter template
ALTER TABLE "tasks" ADD COLUMN "language" "Language" NOT NULL DEFAULT 'C';
ALTER TABLE "tasks" ADD COLUMN "starterCode" TEXT;

-- Backfill language from the first element of the old array (existing rows are
-- all ['C']; a ['C','JAVA'] task collapses to 'C' and the teacher re-picks).
UPDATE "tasks"
SET "language" = "allowedLanguages"[1]
WHERE array_length("allowedLanguages", 1) >= 1;

-- Backfill starter code from the child row matching the chosen language.
UPDATE "tasks" t
SET "starterCode" = sc."code"
FROM "task_starter_codes" sc
WHERE sc."taskId" = t."id" AND sc."language" = t."language";

-- DropForeignKey / DropTable
ALTER TABLE "task_starter_codes" DROP CONSTRAINT "task_starter_codes_taskId_fkey";
DROP TABLE "task_starter_codes";

-- DropColumn
ALTER TABLE "tasks" DROP COLUMN "allowedLanguages";
