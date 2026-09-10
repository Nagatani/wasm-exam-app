-- AlterTable: bulk-provisioned student accounts
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "initialPassword" TEXT;
