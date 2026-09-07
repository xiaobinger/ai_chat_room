-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(100) NOT NULL,
    `displayName` VARCHAR(64) NOT NULL,
    `avatarColor` VARCHAR(7) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentProfile` (
    `id` VARCHAR(36) NOT NULL,
    `ownerId` VARCHAR(36) NULL,
    `name` VARCHAR(64) NOT NULL,
    `tagline` VARCHAR(120) NOT NULL,
    `description` TEXT NOT NULL,
    `systemPrompt` TEXT NOT NULL,
    `avatarColor` VARCHAR(7) NOT NULL DEFAULT '#7457ff',
    `rationality` INTEGER NOT NULL DEFAULT 50,
    `aggressiveness` INTEGER NOT NULL DEFAULT 50,
    `isBuiltIn` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AgentProfile_ownerId_idx`(`ownerId`),
    INDEX `AgentProfile_isBuiltIn_idx`(`isBuiltIn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Room` (
    `id` VARCHAR(36) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `mode` ENUM('structured', 'free') NOT NULL DEFAULT 'free',
    `status` ENUM('draft', 'idle', 'running', 'paused', 'ended', 'archived') NOT NULL DEFAULT 'draft',
    `visibility` ENUM('private', 'public') NOT NULL DEFAULT 'private',
    `language` VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    `ownerId` VARCHAR(36) NOT NULL,
    `messageSeq` INTEGER NOT NULL DEFAULT 0,
    `membersCanChat` BOOLEAN NOT NULL DEFAULT true,
    `membersCanModifyTopic` BOOLEAN NOT NULL DEFAULT false,
    `membersCanAddRoles` BOOLEAN NOT NULL DEFAULT false,
    `membersCanStartRun` BOOLEAN NOT NULL DEFAULT false,
    `moderatorEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Room_ownerId_idx`(`ownerId`),
    INDEX `Room_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoomRole` (
    `id` VARCHAR(36) NOT NULL,
    `roomId` VARCHAR(36) NOT NULL,
    `profileId` VARCHAR(36) NULL,
    `name` VARCHAR(64) NOT NULL,
    `type` ENUM('host', 'debater', 'observer') NOT NULL,
    `systemPrompt` TEXT NOT NULL,
    `color` VARCHAR(7) NULL,
    `modelName` VARCHAR(64) NOT NULL DEFAULT 'auto',
    `stance` VARCHAR(500) NOT NULL DEFAULT '',
    `aggressiveness` INTEGER NOT NULL DEFAULT 50,
    `priority` INTEGER NOT NULL DEFAULT 50,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RoomRole_roomId_idx`(`roomId`),
    INDEX `RoomRole_profileId_idx`(`profileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Membership` (
    `id` VARCHAR(36) NOT NULL,
    `roomId` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `roleId` VARCHAR(36) NULL,
    `status` ENUM('invited', 'approved', 'rejected', 'left') NOT NULL DEFAULT 'invited',
    `intent` ENUM('discuss', 'observe') NOT NULL DEFAULT 'discuss',
    `joinedAt` DATETIME(3) NULL,
    `leftAt` DATETIME(3) NULL,

    INDEX `Membership_roomId_status_idx`(`roomId`, `status`),
    INDEX `Membership_userId_idx`(`userId`),
    UNIQUE INDEX `Membership_roomId_userId_key`(`roomId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModeratorPolicy` (
    `id` VARCHAR(36) NOT NULL,
    `roomId` VARCHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `rules` JSON NOT NULL,
    `ladder` JSON NOT NULL,
    `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(36) NOT NULL,

    INDEX `ModeratorPolicy_roomId_idx`(`roomId`),
    UNIQUE INDEX `ModeratorPolicy_roomId_version_key`(`roomId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DiscussionRun` (
    `id` VARCHAR(36) NOT NULL,
    `roomId` VARCHAR(36) NOT NULL,
    `topic` VARCHAR(500) NOT NULL,
    `goal` VARCHAR(500) NOT NULL DEFAULT '',
    `completionCriteria` VARCHAR(500) NOT NULL DEFAULT '',
    `status` ENUM('draft', 'queued', 'running', 'paused', 'completed', 'terminated', 'failed') NOT NULL DEFAULT 'draft',
    `currentRound` INTEGER NOT NULL DEFAULT 0,
    `settings` JSON NOT NULL,
    `terminationReason` ENUM('round_limit', 'token_budget', 'cost_budget', 'time_limit', 'repetition_loop', 'safety_violation', 'no_available_agents', 'owner_terminated', 'user_cancelled') NULL,
    `leaseToken` VARCHAR(64) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(36) NOT NULL,

    INDEX `DiscussionRun_roomId_status_idx`(`roomId`, `status`),
    INDEX `DiscussionRun_leaseExpiresAt_idx`(`leaseExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RunAgentState` (
    `runId` VARCHAR(36) NOT NULL,
    `roleId` VARCHAR(36) NOT NULL,
    `state` ENUM('idle', 'thinking', 'speaking', 'muted', 'removed', 'error') NOT NULL DEFAULT 'idle',
    `mutedUntilRound` INTEGER NOT NULL DEFAULT 0,
    `consecutiveTurns` INTEGER NOT NULL DEFAULT 0,
    `errorCount` INTEGER NOT NULL DEFAULT 0,
    `lastSpokeRound` INTEGER NOT NULL DEFAULT -1,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RunAgentState_runId_state_idx`(`runId`, `state`),
    PRIMARY KEY (`runId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(36) NOT NULL,
    `roomId` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NULL,
    `sequence` INTEGER NOT NULL,
    `senderType` ENUM('user', 'agent', 'system', 'moderator') NOT NULL,
    `senderId` VARCHAR(36) NULL,
    `roleId` VARCHAR(36) NULL,
    `content` TEXT NOT NULL,
    `status` ENUM('pending', 'streaming', 'completed', 'failed', 'deleted') NOT NULL DEFAULT 'completed',
    `tokens` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Message_roomId_createdAt_idx`(`roomId`, `createdAt`),
    INDEX `Message_runId_sequence_idx`(`runId`, `sequence`),
    UNIQUE INDEX `Message_roomId_sequence_key`(`roomId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModerationEvent` (
    `id` VARCHAR(36) NOT NULL,
    `roomId` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NULL,
    `actorType` ENUM('owner', 'moderator', 'system') NOT NULL DEFAULT 'moderator',
    `actorId` VARCHAR(36) NULL,
    `targetType` ENUM('role', 'user') NOT NULL DEFAULT 'role',
    `targetUserId` VARCHAR(36) NULL,
    `targetRoleId` VARCHAR(36) NULL,
    `action` ENUM('remind', 'warn', 'mute', 'kick', 'revoke') NOT NULL,
    `reason` TEXT NOT NULL,
    `matchedRule` VARCHAR(64) NULL,
    `policyVersion` INTEGER NULL,
    `evidenceMessageIds` JSON NOT NULL,
    `evidenceMessageId` VARCHAR(36) NULL,
    `durationRounds` INTEGER NULL,
    `penaltyLevel` INTEGER NULL,
    `createdBy` VARCHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revertedAt` DATETIME(3) NULL,
    `revertedBy` VARCHAR(36) NULL,

    INDEX `ModerationEvent_roomId_createdAt_idx`(`roomId`, `createdAt`),
    INDEX `ModerationEvent_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PenaltyState` (
    `roomId` VARCHAR(36) NOT NULL,
    `targetRoleId` VARCHAR(36) NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 0,
    `lastRunId` VARCHAR(36) NULL,
    `lastEventId` VARCHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`roomId`, `targetRoleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DiscussionSummary` (
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `status` ENUM('pending', 'generating', 'ready', 'failed') NOT NULL DEFAULT 'pending',
    `payload` JSON NOT NULL,
    `sourceMessageIds` JSON NOT NULL,
    `error` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DiscussionSummary_runId_key`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Room` ADD CONSTRAINT `Room_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoomRole` ADD CONSTRAINT `RoomRole_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoomRole` ADD CONSTRAINT `RoomRole_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `AgentProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `RoomRole`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModeratorPolicy` ADD CONSTRAINT `ModeratorPolicy_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModeratorPolicy` ADD CONSTRAINT `ModeratorPolicy_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DiscussionRun` ADD CONSTRAINT `DiscussionRun_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DiscussionRun` ADD CONSTRAINT `DiscussionRun_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RunAgentState` ADD CONSTRAINT `RunAgentState_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `DiscussionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RunAgentState` ADD CONSTRAINT `RunAgentState_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `RoomRole`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `DiscussionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `RoomRole`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModerationEvent` ADD CONSTRAINT `ModerationEvent_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModerationEvent` ADD CONSTRAINT `ModerationEvent_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `DiscussionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModerationEvent` ADD CONSTRAINT `ModerationEvent_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModerationEvent` ADD CONSTRAINT `ModerationEvent_targetRoleId_fkey` FOREIGN KEY (`targetRoleId`) REFERENCES `RoomRole`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModerationEvent` ADD CONSTRAINT `ModerationEvent_evidenceMessageId_fkey` FOREIGN KEY (`evidenceMessageId`) REFERENCES `Message`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModerationEvent` ADD CONSTRAINT `ModerationEvent_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModerationEvent` ADD CONSTRAINT `ModerationEvent_revertedBy_fkey` FOREIGN KEY (`revertedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PenaltyState` ADD CONSTRAINT `PenaltyState_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PenaltyState` ADD CONSTRAINT `PenaltyState_targetRoleId_fkey` FOREIGN KEY (`targetRoleId`) REFERENCES `RoomRole`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PenaltyState` ADD CONSTRAINT `PenaltyState_lastRunId_fkey` FOREIGN KEY (`lastRunId`) REFERENCES `DiscussionRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DiscussionSummary` ADD CONSTRAINT `DiscussionSummary_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `DiscussionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
