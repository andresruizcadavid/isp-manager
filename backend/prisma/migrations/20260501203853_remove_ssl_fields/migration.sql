/*
  Warnings:

  - You are about to drop the column `apiSslPort` on the `routers` table. All the data in the column will be lost.
  - You are about to drop the column `useSSL` on the `routers` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "routers" DROP COLUMN "apiSslPort",
DROP COLUMN "useSSL";
