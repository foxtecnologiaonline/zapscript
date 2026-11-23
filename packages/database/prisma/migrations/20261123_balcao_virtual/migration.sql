-- CreateTable
CREATE TABLE "BvOrg" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvSector" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvSector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvUser" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ATENDENTE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sectorId" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxConcurrent" INTEGER NOT NULL DEFAULT 3,
    "presence" TEXT NOT NULL DEFAULT 'OFFLINE',
    "presenceAt" TIMESTAMP(3),
    "sipExtension" TEXT,
    "totpSecretEnc" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "oidcSub" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvApiToken" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvQueue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "strategy" TEXT NOT NULL DEFAULT 'LEAST_BUSY',
    "slaFirstResponseSec" INTEGER NOT NULL DEFAULT 300,
    "slaResolutionSec" INTEGER,
    "maxWaitSec" INTEGER,
    "overflowQueueId" TEXT,
    "businessHours" JSONB,
    "sectorId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvQueueMember" (
    "queueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "BvQueueMember_pkey" PRIMARY KEY ("queueId","userId")
);

-- CreateTable
CREATE TABLE "BvRoutingRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "action" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvHoliday" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "BvHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvCannedResponse" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvCannedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvContact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "documentEnc" TEXT,
    "documentHash" TEXT,
    "category" TEXT NOT NULL DEFAULT 'CIDADAO',
    "govbrSub" TEXT,
    "govbrLevel" TEXT,
    "identityVerifiedAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mergedIntoId" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvContactIdentity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvContactIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvConversation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "queueId" TEXT,
    "assignedUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BOT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "intent" TEXT,
    "subject" TEXT,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "channelRef" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "botHandled" BOOLEAN NOT NULL DEFAULT false,
    "resolvedByBot" BOOLEAN NOT NULL DEFAULT false,
    "firstContactResolved" BOOLEAN,
    "automatable" BOOLEAN NOT NULL DEFAULT false,
    "slaFirstResponseDueAt" TIMESTAMP(3),
    "slaResolutionDueAt" TIMESTAMP(3),
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "csatScore" INTEGER,
    "csatComment" TEXT,
    "csatAt" TIMESTAMP(3),
    "transferCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "unreadForAgent" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderUserId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "attachments" JSONB,
    "channelMessageId" TEXT,
    "channelMeta" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "errorCode" TEXT,
    "aiMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvConversationEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorUserId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvConversationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvCall" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT,
    "direction" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "sipCallId" TEXT,
    "ariChannelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RINGING',
    "ivrFlowId" TEXT,
    "ivrPath" JSONB,
    "agentUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "recordingKey" TEXT,
    "recordingSha256" TEXT,
    "recordingSizeBytes" BIGINT,
    "recordingNotified" BOOLEAN NOT NULL DEFAULT false,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvIvrFlow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "definition" JSONB NOT NULL,
    "createdById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvIvrFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvKbArticle" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceConversationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "search" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('portuguese', coalesce("title", '') || ' ' || coalesce("question", '')), 'A') ||
        setweight(to_tsvector('portuguese', coalesce("answer", '')), 'B')
    ) STORED,

    CONSTRAINT "BvKbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvKbArticleVersion" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvKbArticleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvKbSuggestion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "proposedAnswer" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "articleId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvKbSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvTask" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INTERNAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "origin" TEXT NOT NULL DEFAULT 'AGENT',
    "sectorId" TEXT,
    "assigneeId" TEXT,
    "creatorId" TEXT,
    "conversationId" TEXT,
    "contactId" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notifyOnClose" BOOLEAN NOT NULL DEFAULT false,
    "notifyChannel" TEXT,
    "closeNoticeSentAt" TIMESTAMP(3),
    "supportLevel" TEXT,
    "respondedAt" TIMESTAMP(3),
    "slaResponseDueAt" TIMESTAMP(3),
    "slaResolutionDueAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvTaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvTaskHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvTaskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvAuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "meta" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvConfigVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvUsageDaily" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "BvUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvQuota" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "limit" BIGINT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'ALERT',
    "alertAtPct" INTEGER NOT NULL DEFAULT 80,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvCounter" (
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BvCounter_pkey" PRIMARY KEY ("orgId","name")
);

-- CreateTable
CREATE TABLE "BvIntegration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configEnc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNCONFIGURED',
    "lastCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvIntegrationLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "durationMs" INTEGER,
    "error" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvIntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvWebchatSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "origin" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "BvWebchatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvMailbox" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "uidValidity" BIGINT,
    "lastUid" BIGINT NOT NULL DEFAULT 0,
    "lastPolledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BvMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvWaTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'pt_BR',
    "category" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metaTemplateId" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvWaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvReportSchedule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "frequency" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvExportJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'JSON',
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fileKey" TEXT,
    "sha256" TEXT,
    "sizeBytes" BIGINT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "BvExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvDataSubjectRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "handledById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BvDataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvRetentionRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "purged" INTEGER NOT NULL DEFAULT 0,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvRetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BvNotification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BvNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BvOrg_slug_key" ON "BvOrg"("slug");

-- CreateIndex
CREATE INDEX "BvSector_orgId_idx" ON "BvSector"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "BvSector_orgId_name_key" ON "BvSector"("orgId", "name");

-- CreateIndex
CREATE INDEX "BvUser_orgId_role_active_idx" ON "BvUser"("orgId", "role", "active");

-- CreateIndex
CREATE INDEX "BvUser_orgId_presence_idx" ON "BvUser"("orgId", "presence");

-- CreateIndex
CREATE UNIQUE INDEX "BvUser_orgId_email_key" ON "BvUser"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "BvUser_orgId_sipExtension_key" ON "BvUser"("orgId", "sipExtension");

-- CreateIndex
CREATE UNIQUE INDEX "BvSession_refreshHash_key" ON "BvSession"("refreshHash");

-- CreateIndex
CREATE INDEX "BvSession_userId_idx" ON "BvSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BvApiToken_tokenHash_key" ON "BvApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BvApiToken_orgId_idx" ON "BvApiToken"("orgId");

-- CreateIndex
CREATE INDEX "BvQueue_orgId_active_idx" ON "BvQueue"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "BvQueue_orgId_slug_key" ON "BvQueue"("orgId", "slug");

-- CreateIndex
CREATE INDEX "BvQueueMember_userId_idx" ON "BvQueueMember"("userId");

-- CreateIndex
CREATE INDEX "BvRoutingRule_orgId_active_position_idx" ON "BvRoutingRule"("orgId", "active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "BvHoliday_orgId_day_key" ON "BvHoliday"("orgId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "BvCannedResponse_orgId_shortcut_key" ON "BvCannedResponse"("orgId", "shortcut");

-- CreateIndex
CREATE INDEX "BvContact_orgId_email_idx" ON "BvContact"("orgId", "email");

-- CreateIndex
CREATE INDEX "BvContact_orgId_phone_idx" ON "BvContact"("orgId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "BvContact_orgId_documentHash_key" ON "BvContact"("orgId", "documentHash");

-- CreateIndex
CREATE UNIQUE INDEX "BvContact_orgId_govbrSub_key" ON "BvContact"("orgId", "govbrSub");

-- CreateIndex
CREATE INDEX "BvContactIdentity_contactId_idx" ON "BvContactIdentity"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "BvContactIdentity_orgId_channel_externalId_key" ON "BvContactIdentity"("orgId", "channel", "externalId");

-- CreateIndex
CREATE INDEX "BvConversation_orgId_status_queueId_queuedAt_idx" ON "BvConversation"("orgId", "status", "queueId", "queuedAt");

-- CreateIndex
CREATE INDEX "BvConversation_orgId_assignedUserId_status_idx" ON "BvConversation"("orgId", "assignedUserId", "status");

-- CreateIndex
CREATE INDEX "BvConversation_orgId_channel_channelRef_idx" ON "BvConversation"("orgId", "channel", "channelRef");

-- CreateIndex
CREATE INDEX "BvConversation_orgId_closedAt_idx" ON "BvConversation"("orgId", "closedAt");

-- CreateIndex
CREATE INDEX "BvConversation_orgId_startedAt_idx" ON "BvConversation"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "BvConversation_contactId_startedAt_idx" ON "BvConversation"("contactId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BvConversation_orgId_protocol_key" ON "BvConversation"("orgId", "protocol");

-- CreateIndex
CREATE INDEX "BvMessage_conversationId_createdAt_idx" ON "BvMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "BvMessage_orgId_createdAt_idx" ON "BvMessage"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BvMessage_orgId_channelMessageId_key" ON "BvMessage"("orgId", "channelMessageId");

-- CreateIndex
CREATE INDEX "BvConversationEvent_conversationId_createdAt_idx" ON "BvConversationEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "BvConversationEvent_orgId_type_createdAt_idx" ON "BvConversationEvent"("orgId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "BvCall_orgId_startedAt_idx" ON "BvCall"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "BvCall_conversationId_idx" ON "BvCall"("conversationId");

-- CreateIndex
CREATE INDEX "BvCall_orgId_sipCallId_idx" ON "BvCall"("orgId", "sipCallId");

-- CreateIndex
CREATE INDEX "BvIvrFlow_orgId_status_idx" ON "BvIvrFlow"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BvIvrFlow_orgId_name_version_key" ON "BvIvrFlow"("orgId", "name", "version");

-- CreateIndex
CREATE INDEX "BvKbArticle_orgId_status_idx" ON "BvKbArticle"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BvKbArticleVersion_articleId_version_key" ON "BvKbArticleVersion"("articleId", "version");

-- CreateIndex
CREATE INDEX "BvKbSuggestion_orgId_status_idx" ON "BvKbSuggestion"("orgId", "status");

-- CreateIndex
CREATE INDEX "BvTask_orgId_status_priority_idx" ON "BvTask"("orgId", "status", "priority");

-- CreateIndex
CREATE INDEX "BvTask_orgId_assigneeId_status_idx" ON "BvTask"("orgId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "BvTask_orgId_sectorId_status_idx" ON "BvTask"("orgId", "sectorId", "status");

-- CreateIndex
CREATE INDEX "BvTask_orgId_kind_createdAt_idx" ON "BvTask"("orgId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BvTask_orgId_code_key" ON "BvTask"("orgId", "code");

-- CreateIndex
CREATE INDEX "BvTaskComment_taskId_createdAt_idx" ON "BvTaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "BvTaskHistory_taskId_createdAt_idx" ON "BvTaskHistory"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "BvAuditLog_orgId_createdAt_idx" ON "BvAuditLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "BvAuditLog_orgId_entityType_entityId_idx" ON "BvAuditLog"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "BvAuditLog_orgId_actorId_createdAt_idx" ON "BvAuditLog"("orgId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "BvAuditLog_orgId_action_createdAt_idx" ON "BvAuditLog"("orgId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "BvConfigVersion_orgId_entityType_createdAt_idx" ON "BvConfigVersion"("orgId", "entityType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BvConfigVersion_entityType_entityId_version_key" ON "BvConfigVersion"("entityType", "entityId", "version");

-- CreateIndex
CREATE INDEX "BvUsageDaily_orgId_item_day_idx" ON "BvUsageDaily"("orgId", "item", "day");

-- CreateIndex
CREATE UNIQUE INDEX "BvUsageDaily_orgId_day_item_key" ON "BvUsageDaily"("orgId", "day", "item");

-- CreateIndex
CREATE UNIQUE INDEX "BvQuota_orgId_item_period_key" ON "BvQuota"("orgId", "item", "period");

-- CreateIndex
CREATE UNIQUE INDEX "BvIntegration_orgId_type_name_key" ON "BvIntegration"("orgId", "type", "name");

-- CreateIndex
CREATE INDEX "BvIntegrationLog_orgId_type_createdAt_idx" ON "BvIntegrationLog"("orgId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BvWebchatSession_tokenHash_key" ON "BvWebchatSession"("tokenHash");

-- CreateIndex
CREATE INDEX "BvWebchatSession_orgId_conversationId_idx" ON "BvWebchatSession"("orgId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "BvMailbox_orgId_address_key" ON "BvMailbox"("orgId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "BvWaTemplate_orgId_name_language_key" ON "BvWaTemplate"("orgId", "name", "language");

-- CreateIndex
CREATE INDEX "BvReportSchedule_active_nextRunAt_idx" ON "BvReportSchedule"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "BvExportJob_orgId_createdAt_idx" ON "BvExportJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "BvDataSubjectRequest_orgId_status_idx" ON "BvDataSubjectRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "BvRetentionRun_orgId_createdAt_idx" ON "BvRetentionRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "BvNotification_userId_readAt_createdAt_idx" ON "BvNotification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "BvUser" ADD CONSTRAINT "BvUser_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "BvOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvSession" ADD CONSTRAINT "BvSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "BvUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvQueue" ADD CONSTRAINT "BvQueue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "BvOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvQueueMember" ADD CONSTRAINT "BvQueueMember_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "BvQueue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvContact" ADD CONSTRAINT "BvContact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "BvOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvContactIdentity" ADD CONSTRAINT "BvContactIdentity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "BvContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvConversation" ADD CONSTRAINT "BvConversation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "BvOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvConversation" ADD CONSTRAINT "BvConversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "BvContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvConversation" ADD CONSTRAINT "BvConversation_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "BvQueue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvConversation" ADD CONSTRAINT "BvConversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "BvUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvMessage" ADD CONSTRAINT "BvMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BvConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvConversationEvent" ADD CONSTRAINT "BvConversationEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BvConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvCall" ADD CONSTRAINT "BvCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BvConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvKbArticle" ADD CONSTRAINT "BvKbArticle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "BvOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvKbArticleVersion" ADD CONSTRAINT "BvKbArticleVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BvKbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvTask" ADD CONSTRAINT "BvTask_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "BvOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvTask" ADD CONSTRAINT "BvTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BvConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvTaskComment" ADD CONSTRAINT "BvTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BvTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvTaskHistory" ADD CONSTRAINT "BvTaskHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BvTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Busca em texto (português) da base de conhecimento
CREATE INDEX "BvKbArticle_search_idx" ON "BvKbArticle" USING GIN ("search");

-- Auditoria append-only: UPDATE é proibido (DELETE só pela rotina de retenção, que roda como dono da tabela)
CREATE OR REPLACE FUNCTION bv_audit_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BvAuditLog é append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bv_audit_no_update BEFORE UPDATE ON "BvAuditLog"
  FOR EACH ROW EXECUTE FUNCTION bv_audit_no_update();
