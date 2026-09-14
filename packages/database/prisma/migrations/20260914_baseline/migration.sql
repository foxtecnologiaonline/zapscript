-- Baseline squash (2026-09-14): substitui as 86 migrations anteriores (de
-- 20260422_stripe_to_asaas até 20260914_copiloto_triage_confidence — ver
-- histórico do git para os arquivos originais). Aquelas migrations partiam de
-- um init ainda mais antigo (20240609181238_init) que nunca existiu nesta
-- pasta, só no _prisma_migrations da produção — ou seja, `prisma migrate
-- deploy` nunca funcionou contra um banco genuinamente vazio (CI, dev novo).
-- Este arquivo recria o schema completo atual num único passo, gerado via
-- `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma
-- --script` e validado ponta a ponta contra um Postgres local vazio antes de
-- substituir o histórico. Na produção (Supabase, já com o schema todo desde
-- antes), esta migration foi marcada como já aplicada via INSERT manual em
-- _prisma_migrations (mesmo efeito de `prisma migrate resolve --applied`) —
-- nunca rodada de verdade lá, só documentada como presente.
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "document" TEXT,
    "documentHash" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "refCode" TEXT NOT NULL,
    "referralSlug" TEXT,
    "referredBy" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isTester" BOOLEAN NOT NULL DEFAULT false,
    "testerSince" TIMESTAMP(3),
    "privacyPolicyAcceptedAt" TIMESTAMP(3),
    "termsAcceptedAt" TIMESTAMP(3),
    "contractAcceptedAt" TIMESTAMP(3),
    "marketingConsentAt" TIMESTAMP(3),
    "consentDocVersion" TEXT,
    "deletedAt" TIMESTAMP(3),
    "pseudonymizedAt" TIMESTAMP(3),
    "utmSource" TEXT,
    "utmCampaign" TEXT,
    "utmMedium" TEXT,
    "lifecycleEmailsSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lifecycleWhatsappSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minutesPerMonth" INTEGER NOT NULL,
    "audiosPerMonth" INTEGER NOT NULL DEFAULT 0,
    "maxNumbers" INTEGER NOT NULL,
    "priceBrl" DOUBLE PRECISION NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "asaasSubscriptionId" TEXT,
    "asaasCustomerId" TEXT,
    "paymentMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "trialDowngradedAt" TIMESTAMP(3),
    "testerRenewalsUsed" INTEGER NOT NULL DEFAULT 0,
    "comboDiscountPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinuteBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accumulatedMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "extraMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "extraExpiresAt" TIMESTAMP(3),
    "audiosUsed" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "lastAlertSent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MinuteBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappNumber" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL DEFAULT 'pending',
    "displayName" TEXT,
    "sessionEncrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "connectedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "minutesUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "zapiInstanceId" TEXT,
    "zapiToken" TEXT,
    "privateMode" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "publicPurpose" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'evolution',
    "metaWabaId" TEXT,
    "metaPhoneNumberId" TEXT,
    "metaBusinessId" TEXT,
    "metaAccessTokenEnc" TEXT,
    "metaTokenExpiresAt" TIMESTAMP(3),
    "metaMessagingLimitTier" TEXT,
    "metaQualityRating" TEXT,
    "metaLimitsSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappOnboardingLead" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'started',
    "name" TEXT,
    "pushName" TEXT,
    "email" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "numberId" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsappOnboardingLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "filename" TEXT,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "originalText" TEXT NOT NULL,
    "summaryBullets" JSONB NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "language" TEXT NOT NULL DEFAULT 'pt',
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "footerShown" BOOLEAN NOT NULL DEFAULT false,
    "footerVariant" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transcriptionId" TEXT,
    "minutesUsed" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "attachmentUrl" TEXT,
    "attachmentData" TEXT,
    "attachmentFilename" TEXT,
    "attachmentMimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemError" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetResourceId" TEXT,
    "resourceType" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TesterInvite" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "usedBy" TEXT,

    CONSTRAINT "TesterInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyPolicy" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStatusLog" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpsResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NpsResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlertConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAlertConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAtendimento" (
    "id" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "categoria" TEXT,
    "prioridade" TEXT,
    "sentimento" TEXT,
    "confiancaResposta" INTEGER,
    "requerEscalacao" BOOLEAN NOT NULL DEFAULT false,
    "topicos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clienteNome" TEXT,
    "clienteEmail" TEXT,
    "clienteWhatsapp" TEXT,
    "clienteUserId" TEXT,
    "mensagemOriginal" TEXT NOT NULL,
    "rascunhoAgente" TEXT,
    "respostaFinal" TEXT,
    "editadoPeloAdmin" BOOLEAN NOT NULL DEFAULT false,
    "instrucaoRevisao" TEXT,
    "threadId" TEXT,
    "canalExternoId" TEXT,
    "contextoUsado" TEXT,
    "sugestaoFaq" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprovadoEm" TIMESTAMP(3),
    "enviadoEm" TIMESTAMP(3),
    "resolvidoEm" TIMESTAMP(3),

    CONSTRAINT "SupportAtendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "categoria" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canalOrigem" TEXT,
    "atendimentoOrigemId" TEXT,
    "aprovadoPorAdmin" BOOLEAN NOT NULL DEFAULT true,
    "vezesUtilizado" INTEGER NOT NULL DEFAULT 0,
    "utilidadeMedia" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "payoutName" TEXT,
    "audience" TEXT,
    "notes" TEXT,
    "rejectedReason" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "payoutRequestedAt" TIMESTAMP(3),
    "customRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateReferral" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "convertedAt" TIMESTAMP(3),
    "bonusTier" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "saleAmount" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "commissionType" TEXT NOT NULL,
    "monthIndex" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "paidReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateClick" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "country" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "payoutName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletPayout" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "pixKey" TEXT NOT NULL,
    "pixKeyType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidReference" TEXT,

    CONSTRAINT "WalletPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingCredit" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "releaseAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "durationSec" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT,
    "visitorId" TEXT,
    "referrer" TEXT,
    "device" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProContactSeed" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "footerVariant" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProContactSeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqSuggestion" (
    "id" TEXT NOT NULL,
    "tituloSugerido" TEXT NOT NULL,
    "conteudoSugerido" TEXT NOT NULL,
    "categoria" TEXT,
    "atendimentoOrigemId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisadoEm" TIMESTAMP(3),

    CONSTRAINT "FaqSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "priceMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceYearly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'paid',
    "currentPeriodEnd" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CobrancaCliente" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "documento" TEXT,
    "email" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CobrancaCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CobrancaCobranca" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "pagoEm" TIMESTAMP(3),
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "recorrenciaMeses" INTEGER,
    "origemVoz" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CobrancaCobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CobrancaEnvio" (
    "id" TEXT NOT NULL,
    "cobrancaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,

    CONSTRAINT "CobrancaEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CobrancaConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tom" TEXT NOT NULL DEFAULT 'cordial',
    "escalarTom" BOOLEAN NOT NULL DEFAULT true,
    "diasAntes" INTEGER[] DEFAULT ARRAY[1]::INTEGER[],
    "diasDepois" INTEGER[] DEFAULT ARRAY[1, 3, 7]::INTEGER[],
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "resumoDiario" BOOLEAN NOT NULL DEFAULT false,
    "resumoHora" INTEGER NOT NULL DEFAULT 8,
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CobrancaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campanha" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "whatsappNumberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "channel" TEXT NOT NULL DEFAULT 'meta',
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'pt_BR',
    "templateComponents" JSONB,
    "messageBody" TEXT,
    "consentConfirmedAt" TIMESTAMP(3),
    "consentConfirmedIp" TEXT,
    "templateVarCount" INTEGER,
    "poolNumberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "pausedReason" TEXT,
    "audienceCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "sequenceParentId" TEXT,
    "sequenceIndex" INTEGER,
    "sequenceDelayDays" INTEGER,
    "abTestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "variantBTemplateName" TEXT,
    "variantBTemplateLanguage" TEXT,
    "variantBTemplateComponents" JSONB,
    "variantBTemplateVarCount" INTEGER,
    "variantBMessageBody" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdViaChat" BOOLEAN NOT NULL DEFAULT false,
    "messagesCost" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campanha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaContato" (
    "id" TEXT NOT NULL,
    "campanhaId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "variables" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedNumberId" TEXT,
    "variant" TEXT,
    "wamid" TEXT,
    "errorMessage" TEXT,
    "optinConfirmedAt" TIMESTAMP(3),
    "optinTimeoutAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanhaContato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaLista" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "consentConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanhaLista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaListaContato" (
    "id" TEXT NOT NULL,
    "listaId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampanhaListaContato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaOptOut" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampanhaOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableMessages" INTEGER NOT NULL DEFAULT 0,
    "freeMessages" INTEGER NOT NULL DEFAULT 0,
    "freeResetAt" TIMESTAMP(3),
    "paidMessages" INTEGER NOT NULL DEFAULT 0,
    "paidExpiresAt" TIMESTAMP(3),
    "plan" TEXT,
    "asaasSubscriptionId" TEXT,
    "asaasCustomerId" TEXT,
    "renewalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanhaBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaBalanceTransaction" (
    "id" TEXT NOT NULL,
    "balanceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampanhaBalanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanhaChatSession" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'idle',
    "draftMessageBody" TEXT,
    "draftContactSource" TEXT,
    "campanhaId" TEXT,
    "pendingPackageId" TEXT,
    "pendingChargeId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampanhaChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmStage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "company" TEXT,
    "value" DOUBLE PRECISION,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "numberId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lostReason" TEXT,
    "whatsappOptinConfirmedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendeConfig" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "businessContext" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'profissional-amigavel',
    "fallbackMessage" TEXT NOT NULL DEFAULT 'Recebemos sua mensagem! Já já alguém te responde por aqui.',
    "escalationPhone" TEXT,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'equilibrado',
    "digestFrequency" TEXT NOT NULL DEFAULT 'off',
    "lastDigestAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtendeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendeKnowledgeBase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtendeKnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendeConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtendeConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtendeMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "humanAuthored" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "failureReason" TEXT,
    "failureAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtendeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoConfig" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxBriefsPerDay" INTEGER NOT NULL DEFAULT 8,
    "quietStart" TEXT NOT NULL DEFAULT '21:00',
    "quietEnd" TEXT NOT NULL DEFAULT '07:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "aggressiveness" TEXT NOT NULL DEFAULT 'equilibrado',
    "businessContext" TEXT,
    "groupDigestHour" INTEGER NOT NULL DEFAULT 20,
    "groupDigestFrequency" TEXT NOT NULL DEFAULT 'daily',
    "lastTechniqueRecapAt" TIMESTAMP(3),
    "minConfidenceByTipo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBriefedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fromCopiloto" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoBriefing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "temperature" TEXT NOT NULL,
    "blocker" TEXT,
    "riskLevel" TEXT NOT NULL,
    "tipo" TEXT,
    "remetente" TEXT,
    "triageConfidence" DOUBLE PRECISION,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "dismissReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "awaitingRank" INTEGER,
    "awaitingSince" TIMESTAMP(3),
    "deliveredVia" TEXT,
    "actedAt" TIMESTAMP(3),
    "selfChatBody" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoSuggestion" (
    "id" TEXT NOT NULL,
    "briefingId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "axis" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "draft" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "risk" TEXT,
    "technique" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'offered',
    "sentText" TEXT,
    "sentMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "userFeedback" TEXT,
    "commitmentTitle" TEXT,
    "commitmentDueAt" TIMESTAMP(3),
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotoGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoGroupMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderJid" TEXT NOT NULL,
    "senderName" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoGroupMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotoGroupDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "groupsIncluded" INTEGER NOT NULL DEFAULT 0,
    "summaryMd" TEXT NOT NULL,
    "blocksJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotoGroupDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronHeartbeat" (
    "jobName" TEXT NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronHeartbeat_pkey" PRIMARY KEY ("jobName")
);

-- CreateTable
CREATE TABLE "VoiceCommand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT,
    "transcriptionId" TEXT,
    "rawText" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'detected',
    "resultSummary" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientName" TEXT,
    "filename" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "originalText" TEXT,
    "summaryBullets" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegendaJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "originalFilename" TEXT,
    "inputStorageKey" TEXT NOT NULL,
    "inputSizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "language" TEXT NOT NULL DEFAULT 'pt',
    "srtStorageKey" TEXT,
    "vttStorageKey" TEXT,
    "errorMessage" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegendaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "inviteCode" TEXT,
    "invitedEmail" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aviso" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactName" TEXT,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aviso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToId" TEXT,
    "contactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "channels" TEXT[],
    "whatsappNumberId" TEXT,
    "targetReach" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionExecution" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "executor" TEXT NOT NULL DEFAULT 'bot',
    "targetRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proofUrl" TEXT,
    "reachCount" INTEGER,
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_documentHash_key" ON "User"("documentHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_refCode_key" ON "User"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralSlug_key" ON "User"("referralSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "MinuteBalance_userId_key" ON "MinuteBalance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappNumber_metaPhoneNumberId_key" ON "WhatsappNumber"("metaPhoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsappNumber_userId_idx" ON "WhatsappNumber"("userId");

-- CreateIndex
CREATE INDEX "WhatsappNumber_zapiInstanceId_idx" ON "WhatsappNumber"("zapiInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappOnboardingLead_phone_key" ON "WhatsappOnboardingLead"("phone");

-- CreateIndex
CREATE INDEX "WhatsappOnboardingLead_stage_idx" ON "WhatsappOnboardingLead"("stage");

-- CreateIndex
CREATE INDEX "Transcription_userId_idx" ON "Transcription"("userId");

-- CreateIndex
CREATE INDEX "Transcription_userId_createdAt_idx" ON "Transcription"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Transcription_numberId_idx" ON "Transcription"("numberId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageLog_transcriptionId_key" ON "UsageLog"("transcriptionId");

-- CreateIndex
CREATE INDEX "UsageLog_userId_idx" ON "UsageLog"("userId");

-- CreateIndex
CREATE INDEX "UsageLog_createdAt_idx" ON "UsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhook_paymentId_key" ON "ProcessedWebhook"("paymentId");

-- CreateIndex
CREATE INDEX "ProcessedWebhook_processedAt_idx" ON "ProcessedWebhook"("processedAt");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_targetUserId_idx" ON "AuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "TesterInvite_code_key" ON "TesterInvite"("code");

-- CreateIndex
CREATE INDEX "TesterInvite_code_idx" ON "TesterInvite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyPolicy_version_key" ON "PrivacyPolicy"("version");

-- CreateIndex
CREATE INDEX "PrivacyPolicy_version_idx" ON "PrivacyPolicy"("version");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookConfig_userId_key" ON "WebhookConfig"("userId");

-- CreateIndex
CREATE INDEX "ServiceStatusLog_service_checkedAt_idx" ON "ServiceStatusLog"("service", "checkedAt");

-- CreateIndex
CREATE INDEX "NpsResponse_createdAt_idx" ON "NpsResponse"("createdAt");

-- CreateIndex
CREATE INDEX "NpsResponse_userId_idx" ON "NpsResponse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAlertConfig_key_key" ON "AdminAlertConfig"("key");

-- CreateIndex
CREATE INDEX "SupportAtendimento_status_prioridade_idx" ON "SupportAtendimento"("status", "prioridade");

-- CreateIndex
CREATE INDEX "SupportAtendimento_canal_criadoEm_idx" ON "SupportAtendimento"("canal", "criadoEm");

-- CreateIndex
CREATE INDEX "SupportAtendimento_threadId_idx" ON "SupportAtendimento"("threadId");

-- CreateIndex
CREATE INDEX "SupportAtendimento_canalExternoId_idx" ON "SupportAtendimento"("canalExternoId");

-- CreateIndex
CREATE INDEX "SupportAtendimento_clienteUserId_idx" ON "SupportAtendimento"("clienteUserId");

-- CreateIndex
CREATE INDEX "KnowledgeBase_categoria_idx" ON "KnowledgeBase"("categoria");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_userId_key" ON "Affiliate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

-- CreateIndex
CREATE INDEX "Affiliate_status_idx" ON "Affiliate"("status");

-- CreateIndex
CREATE INDEX "Affiliate_code_idx" ON "Affiliate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateReferral_referredUserId_key" ON "AffiliateReferral"("referredUserId");

-- CreateIndex
CREATE INDEX "AffiliateReferral_affiliateId_idx" ON "AffiliateReferral"("affiliateId");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliateId_status_idx" ON "AffiliateCommission"("affiliateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_paymentId_affiliateId_key" ON "AffiliateCommission"("paymentId", "affiliateId");

-- CreateIndex
CREATE INDEX "AffiliateClick_affiliateId_createdAt_idx" ON "AffiliateClick"("affiliateId", "createdAt");

-- CreateIndex
CREATE INDEX "AffiliateClick_code_createdAt_idx" ON "AffiliateClick"("code", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateConfig_key_key" ON "AffiliateConfig"("key");

-- CreateIndex
CREATE INDEX "AffiliateCampaign_active_startsAt_endsAt_idx" ON "AffiliateCampaign"("active", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditWallet_userId_key" ON "CreditWallet"("userId");

-- CreateIndex
CREATE INDEX "WalletPayout_status_requestedAt_idx" ON "WalletPayout"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "WalletPayout_walletId_idx" ON "WalletPayout"("walletId");

-- CreateIndex
CREATE INDEX "CreditTransaction_walletId_createdAt_idx" ON "CreditTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingCredit_paymentId_key" ON "PendingCredit"("paymentId");

-- CreateIndex
CREATE INDEX "PendingCredit_status_releaseAt_idx" ON "PendingCredit"("status", "releaseAt");

-- CreateIndex
CREATE INDEX "PendingCredit_walletId_idx" ON "PendingCredit"("walletId");

-- CreateIndex
CREATE INDEX "DemoLead_email_idx" ON "DemoLead"("email");

-- CreateIndex
CREATE INDEX "DemoLead_createdAt_idx" ON "DemoLead"("createdAt");

-- CreateIndex
CREATE INDEX "SiteEvent_type_createdAt_idx" ON "SiteEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SiteEvent_createdAt_idx" ON "SiteEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SiteEvent_path_idx" ON "SiteEvent"("path");

-- CreateIndex
CREATE INDEX "SiteEvent_country_idx" ON "SiteEvent"("country");

-- CreateIndex
CREATE INDEX "SiteEvent_visitorId_idx" ON "SiteEvent"("visitorId");

-- CreateIndex
CREATE INDEX "ProContactSeed_userId_idx" ON "ProContactSeed"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProContactSeed_userId_contactId_key" ON "ProContactSeed"("userId", "contactId");

-- CreateIndex
CREATE INDEX "FaqSuggestion_status_idx" ON "FaqSuggestion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_key_key" ON "Product"("key");

-- CreateIndex
CREATE INDEX "Entitlement_userId_status_idx" ON "Entitlement"("userId", "status");

-- CreateIndex
CREATE INDEX "Entitlement_productKey_idx" ON "Entitlement"("productKey");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_userId_productKey_key" ON "Entitlement"("userId", "productKey");

-- CreateIndex
CREATE INDEX "CobrancaCliente_userId_deletedAt_idx" ON "CobrancaCliente"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "CobrancaCobranca_userId_status_vencimento_idx" ON "CobrancaCobranca"("userId", "status", "vencimento");

-- CreateIndex
CREATE INDEX "CobrancaCobranca_clienteId_idx" ON "CobrancaCobranca"("clienteId");

-- CreateIndex
CREATE INDEX "CobrancaEnvio_cobrancaId_tipo_idx" ON "CobrancaEnvio"("cobrancaId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "CobrancaConfig_userId_key" ON "CobrancaConfig"("userId");

-- CreateIndex
CREATE INDEX "Campanha_userId_idx" ON "Campanha"("userId");

-- CreateIndex
CREATE INDEX "Campanha_whatsappNumberId_idx" ON "Campanha"("whatsappNumberId");

-- CreateIndex
CREATE INDEX "Campanha_status_idx" ON "Campanha"("status");

-- CreateIndex
CREATE INDEX "Campanha_sequenceParentId_idx" ON "Campanha"("sequenceParentId");

-- CreateIndex
CREATE INDEX "CampanhaContato_campanhaId_idx" ON "CampanhaContato"("campanhaId");

-- CreateIndex
CREATE INDEX "CampanhaContato_campanhaId_status_idx" ON "CampanhaContato"("campanhaId", "status");

-- CreateIndex
CREATE INDEX "CampanhaContato_wamid_idx" ON "CampanhaContato"("wamid");

-- CreateIndex
CREATE INDEX "CampanhaLista_userId_idx" ON "CampanhaLista"("userId");

-- CreateIndex
CREATE INDEX "CampanhaListaContato_listaId_idx" ON "CampanhaListaContato"("listaId");

-- CreateIndex
CREATE UNIQUE INDEX "CampanhaListaContato_listaId_phone_key" ON "CampanhaListaContato"("listaId", "phone");

-- CreateIndex
CREATE INDEX "CampanhaOptOut_userId_idx" ON "CampanhaOptOut"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CampanhaOptOut_userId_phone_key" ON "CampanhaOptOut"("userId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CampanhaBalance_userId_key" ON "CampanhaBalance"("userId");

-- CreateIndex
CREATE INDEX "CampanhaBalanceTransaction_balanceId_createdAt_idx" ON "CampanhaBalanceTransaction"("balanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampanhaChatSession_phone_key" ON "CampanhaChatSession"("phone");

-- CreateIndex
CREATE INDEX "CampanhaChatSession_userId_idx" ON "CampanhaChatSession"("userId");

-- CreateIndex
CREATE INDEX "CrmStage_userId_order_idx" ON "CrmStage"("userId", "order");

-- CreateIndex
CREATE INDEX "CrmContact_userId_stageId_idx" ON "CrmContact"("userId", "stageId");

-- CreateIndex
CREATE INDEX "CrmContact_userId_lastActivityAt_idx" ON "CrmContact"("userId", "lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "CrmContact_stageId_idx" ON "CrmContact"("stageId");

-- CreateIndex
CREATE INDEX "CrmContact_numberId_idx" ON "CrmContact"("numberId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_userId_phone_key" ON "CrmContact"("userId", "phone");

-- CreateIndex
CREATE INDEX "CrmActivity_contactId_createdAt_idx" ON "CrmActivity"("contactId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CrmActivity_userId_dueAt_idx" ON "CrmActivity"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "AtendeConfig_numberId_key" ON "AtendeConfig"("numberId");

-- CreateIndex
CREATE INDEX "AtendeConfig_userId_idx" ON "AtendeConfig"("userId");

-- CreateIndex
CREATE INDEX "AtendeKnowledgeBase_userId_active_idx" ON "AtendeKnowledgeBase"("userId", "active");

-- CreateIndex
CREATE INDEX "AtendeConversation_userId_lastMessageAt_idx" ON "AtendeConversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "AtendeConversation_archived_idx" ON "AtendeConversation"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "AtendeConversation_numberId_contactPhone_key" ON "AtendeConversation"("numberId", "contactPhone");

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_createdAt_idx" ON "AiUsageLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AtendeMessage_conversationId_createdAt_idx" ON "AtendeMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AtendeMessage_status_idx" ON "AtendeMessage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoConfig_numberId_key" ON "CopilotoConfig"("numberId");

-- CreateIndex
CREATE INDEX "CopilotoConfig_userId_idx" ON "CopilotoConfig"("userId");

-- CreateIndex
CREATE INDEX "CopilotoConversation_userId_lastMessageAt_idx" ON "CopilotoConversation"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoConversation_numberId_contactPhone_key" ON "CopilotoConversation"("numberId", "contactPhone");

-- CreateIndex
CREATE INDEX "CopilotoMessage_conversationId_createdAt_idx" ON "CopilotoMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotoMessage_conversationId_externalId_idx" ON "CopilotoMessage"("conversationId", "externalId");

-- CreateIndex
CREATE INDEX "CopilotoBriefing_userId_createdAt_idx" ON "CopilotoBriefing"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CopilotoBriefing_numberId_status_createdAt_idx" ON "CopilotoBriefing"("numberId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CopilotoBriefing_tipo_idx" ON "CopilotoBriefing"("tipo");

-- CreateIndex
CREATE INDEX "CopilotoBriefing_sensitive_tipo_idx" ON "CopilotoBriefing"("sensitive", "tipo");

-- CreateIndex
CREATE INDEX "CopilotoBriefing_conversationId_tipo_createdAt_idx" ON "CopilotoBriefing"("conversationId", "tipo", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotoSuggestion_briefingId_idx" ON "CopilotoSuggestion"("briefingId");

-- CreateIndex
CREATE INDEX "CopilotoSuggestion_technique_outcome_idx" ON "CopilotoSuggestion"("technique", "outcome");

-- CreateIndex
CREATE INDEX "CopilotoGroup_userId_active_idx" ON "CopilotoGroup"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoGroup_numberId_groupJid_key" ON "CopilotoGroup"("numberId", "groupJid");

-- CreateIndex
CREATE INDEX "CopilotoGroupMessage_groupId_createdAt_idx" ON "CopilotoGroupMessage"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "CopilotoGroupDigest_userId_createdAt_idx" ON "CopilotoGroupDigest"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotoGroupDigest_numberId_date_key" ON "CopilotoGroupDigest"("numberId", "date");

-- CreateIndex
CREATE INDEX "VoiceCommand_userId_createdAt_idx" ON "VoiceCommand"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SalesVisit_userId_createdAt_idx" ON "SalesVisit"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LegendaJob_userId_createdAt_idx" ON "LegendaJob"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LegendaJob_status_idx" ON "LegendaJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_ownerId_idx" ON "Team"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_key" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_inviteCode_key" ON "TeamMember"("inviteCode");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "Aviso_userId_createdAt_idx" ON "Aviso"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Aviso_numberId_idx" ON "Aviso"("numberId");

-- CreateIndex
CREATE INDEX "Task_userId_status_idx" ON "Task"("userId", "status");

-- CreateIndex
CREATE INDEX "Task_userId_dueAt_idx" ON "Task"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "Task_contactId_idx" ON "Task"("contactId");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "Task"("assignedToId");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_userId_idx" ON "TaskComment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_key_key" ON "Mission"("key");

-- CreateIndex
CREATE INDEX "Mission_status_idx" ON "Mission"("status");

-- CreateIndex
CREATE INDEX "MissionExecution_missionId_status_idx" ON "MissionExecution"("missionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MissionExecution_missionId_channel_targetRef_key" ON "MissionExecution"("missionId", "channel", "targetRef");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinuteBalance" ADD CONSTRAINT "MinuteBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappNumber" ADD CONSTRAINT "WhatsappNumber_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcription" ADD CONSTRAINT "Transcription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcription" ADD CONSTRAINT "Transcription_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_transcriptionId_fkey" FOREIGN KEY ("transcriptionId") REFERENCES "Transcription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookConfig" ADD CONSTRAINT "WebhookConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpsResponse" ADD CONSTRAINT "NpsResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAtendimento" ADD CONSTRAINT "SupportAtendimento_clienteUserId_fkey" FOREIGN KEY ("clienteUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Affiliate" ADD CONSTRAINT "Affiliate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletPayout" ADD CONSTRAINT "WalletPayout_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingCredit" ADD CONSTRAINT "PendingCredit_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProContactSeed" ADD CONSTRAINT "ProContactSeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_productKey_fkey" FOREIGN KEY ("productKey") REFERENCES "Product"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobrancaCliente" ADD CONSTRAINT "CobrancaCliente_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobrancaCobranca" ADD CONSTRAINT "CobrancaCobranca_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobrancaCobranca" ADD CONSTRAINT "CobrancaCobranca_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "CobrancaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobrancaEnvio" ADD CONSTRAINT "CobrancaEnvio_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "CobrancaCobranca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CobrancaConfig" ADD CONSTRAINT "CobrancaConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_sequenceParentId_fkey" FOREIGN KEY ("sequenceParentId") REFERENCES "Campanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campanha" ADD CONSTRAINT "Campanha_whatsappNumberId_fkey" FOREIGN KEY ("whatsappNumberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaContato" ADD CONSTRAINT "CampanhaContato_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "Campanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaLista" ADD CONSTRAINT "CampanhaLista_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaListaContato" ADD CONSTRAINT "CampanhaListaContato_listaId_fkey" FOREIGN KEY ("listaId") REFERENCES "CampanhaLista"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaOptOut" ADD CONSTRAINT "CampanhaOptOut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaBalance" ADD CONSTRAINT "CampanhaBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanhaBalanceTransaction" ADD CONSTRAINT "CampanhaBalanceTransaction_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "CampanhaBalance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CrmStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeConfig" ADD CONSTRAINT "AtendeConfig_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeConfig" ADD CONSTRAINT "AtendeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeKnowledgeBase" ADD CONSTRAINT "AtendeKnowledgeBase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeConversation" ADD CONSTRAINT "AtendeConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeConversation" ADD CONSTRAINT "AtendeConversation_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtendeMessage" ADD CONSTRAINT "AtendeMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AtendeConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConfig" ADD CONSTRAINT "CopilotoConfig_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConfig" ADD CONSTRAINT "CopilotoConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConversation" ADD CONSTRAINT "CopilotoConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoConversation" ADD CONSTRAINT "CopilotoConversation_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoMessage" ADD CONSTRAINT "CopilotoMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CopilotoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoBriefing" ADD CONSTRAINT "CopilotoBriefing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoBriefing" ADD CONSTRAINT "CopilotoBriefing_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CopilotoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoSuggestion" ADD CONSTRAINT "CopilotoSuggestion_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "CopilotoBriefing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoGroup" ADD CONSTRAINT "CopilotoGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoGroup" ADD CONSTRAINT "CopilotoGroup_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoGroupMessage" ADD CONSTRAINT "CopilotoGroupMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CopilotoGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotoGroupDigest" ADD CONSTRAINT "CopilotoGroupDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCommand" ADD CONSTRAINT "VoiceCommand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesVisit" ADD CONSTRAINT "SalesVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegendaJob" ADD CONSTRAINT "LegendaJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aviso" ADD CONSTRAINT "Aviso_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aviso" ADD CONSTRAINT "Aviso_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_whatsappNumberId_fkey" FOREIGN KEY ("whatsappNumberId") REFERENCES "WhatsappNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionExecution" ADD CONSTRAINT "MissionExecution_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

