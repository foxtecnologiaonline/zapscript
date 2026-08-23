-- Índices para foreign keys sem cobertura, apontadas pelo advisor de
-- performance do Supabase (achado da auditoria de 2026-08-22). Sem índice
-- numa FK, todo JOIN e todo DELETE em cascata na tabela referenciada faz
-- table scan na tabela filha. IF NOT EXISTS: seguro rodar mesmo se algum já
-- tiver sido criado manualmente antes desta migration.

CREATE INDEX IF NOT EXISTS "Aviso_numberId_idx" ON "Aviso"("numberId");
CREATE INDEX IF NOT EXISTS "CrmContact_numberId_idx" ON "CrmContact"("numberId");
CREATE INDEX IF NOT EXISTS "CrmContact_stageId_idx" ON "CrmContact"("stageId");
CREATE INDEX IF NOT EXISTS "Entitlement_productKey_idx" ON "Entitlement"("productKey");
CREATE INDEX IF NOT EXISTS "PendingCredit_walletId_idx" ON "PendingCredit"("walletId");
CREATE INDEX IF NOT EXISTS "Subscription_planId_idx" ON "Subscription"("planId");
CREATE INDEX IF NOT EXISTS "SupportAtendimento_clienteUserId_idx" ON "SupportAtendimento"("clienteUserId");
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_idx" ON "SupportTicket"("userId");
CREATE INDEX IF NOT EXISTS "Task_assignedToId_idx" ON "Task"("assignedToId");
CREATE INDEX IF NOT EXISTS "TaskComment_userId_idx" ON "TaskComment"("userId");
CREATE INDEX IF NOT EXISTS "Transcription_numberId_idx" ON "Transcription"("numberId");
CREATE INDEX IF NOT EXISTS "WalletPayout_walletId_idx" ON "WalletPayout"("walletId");
