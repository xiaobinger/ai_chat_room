-- CreateTable
CREATE TABLE `RunScheduleAudit` (
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `round` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RunScheduleAudit_runId_round_idx`(`runId`, `round`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RunScheduleAudit` ADD CONSTRAINT `RunScheduleAudit_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `DiscussionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
