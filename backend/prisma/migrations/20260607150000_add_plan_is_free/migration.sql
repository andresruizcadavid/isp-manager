-- Free-plan flag for trueque / cortesía clients. See Plan.isFree in
-- backend/prisma/schema.prisma for the full semantics.
ALTER TABLE "plans"
  ADD COLUMN "isFree" BOOLEAN NOT NULL DEFAULT false;
