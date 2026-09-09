-- Per-task language selection + per-language starter code.
--
-- 1. New child table task_starter_codes (replaces tasks.starterCodeC / starterCodeJava).
-- 2. New tasks.allowedLanguages array (defaults to [C]).
-- 3. Backfill existing scalar starter code into the child table, and mark any
--    task that already had Java starter code as also allowing JAVA.
-- 4. Drop the old scalar columns.

-- CreateTable
CREATE TABLE "task_starter_codes" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "task_starter_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_starter_codes_taskId_idx" ON "task_starter_codes"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_starter_codes_taskId_language_key" ON "task_starter_codes"("taskId", "language");

-- AddForeignKey
ALTER TABLE "task_starter_codes" ADD CONSTRAINT "task_starter_codes_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "allowedLanguages" "Language"[] DEFAULT ARRAY['C']::"Language"[];

-- Backfill: move scalar starter code into the child table.
INSERT INTO "task_starter_codes" ("id", "taskId", "language", "code")
SELECT gen_random_uuid(), "id", 'C'::"Language", "starterCodeC"
FROM "tasks"
WHERE "starterCodeC" IS NOT NULL AND "starterCodeC" <> '';

INSERT INTO "task_starter_codes" ("id", "taskId", "language", "code")
SELECT gen_random_uuid(), "id", 'JAVA'::"Language", "starterCodeJava"
FROM "tasks"
WHERE "starterCodeJava" IS NOT NULL AND "starterCodeJava" <> '';

-- A task that already carried Java starter code was authored for Java too.
UPDATE "tasks"
SET "allowedLanguages" = ARRAY['C', 'JAVA']::"Language"[]
WHERE "starterCodeJava" IS NOT NULL AND "starterCodeJava" <> '';

-- Now that every row has a value, make the column strictly NOT NULL. The
-- [C] default stays (matches @default([C]) in schema.prisma).
ALTER TABLE "tasks" ALTER COLUMN "allowedLanguages" SET NOT NULL;

-- DropColumn
ALTER TABLE "tasks" DROP COLUMN "starterCodeC";
ALTER TABLE "tasks" DROP COLUMN "starterCodeJava";
