-- The model gateway is gone: Stack AI is the delivery system of record, not a
-- model proxy. The per-call ledger it wrote and the per-project budget it fed
-- are removed with it. Coding agents call their own provider directly; the
-- Claude key in secrets/.env now belongs to the coding agent, not to this stack.

DROP TABLE IF EXISTS "ModelCall";

ALTER TABLE "Project" DROP COLUMN IF EXISTS "gatewayUrl";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "budgetUsd";
