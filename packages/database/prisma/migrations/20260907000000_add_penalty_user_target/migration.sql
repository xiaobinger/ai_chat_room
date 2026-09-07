-- PenaltyState 支持人类维度处罚
-- 由于旧主键被外键依赖，用重建表的方式迁移

-- 1. 建新表（显式指定 collation 与 Room.id 一致）
CREATE TABLE `PenaltyState_new` (
  `id` VARCHAR(36) NOT NULL,
  `roomId` VARCHAR(36) NOT NULL,
  `targetRoleId` VARCHAR(36) NULL,
  `targetUserId` VARCHAR(36) NULL,
  `level` INT NOT NULL DEFAULT 0,
  `lastRunId` VARCHAR(36) NULL,
  `lastEventId` VARCHAR(36) NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PenaltyState_roomId_targetRoleId_targetUserId_key` (`roomId`, `targetRoleId`, `targetUserId`),
  INDEX `PenaltyState_roomId_idx` (`roomId`),
  CONSTRAINT `PenaltyState_new_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room` (`id`) ON DELETE CASCADE,
  CONSTRAINT `PenaltyState_new_targetRoleId_fkey` FOREIGN KEY (`targetRoleId`) REFERENCES `RoomRole` (`id`) ON DELETE CASCADE,
  CONSTRAINT `PenaltyState_new_lastRunId_fkey` FOREIGN KEY (`lastRunId`) REFERENCES `DiscussionRun` (`id`) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- 2. 复制数据
INSERT INTO `PenaltyState_new` (`id`, `roomId`, `targetRoleId`, `level`, `lastRunId`, `lastEventId`, `updatedAt`)
  SELECT UUID(), `roomId`, `targetRoleId`, `level`, `lastRunId`, `lastEventId`, `updatedAt`
  FROM `PenaltyState`;

-- 3. 删旧表，重命名新表
DROP TABLE `PenaltyState`;
ALTER TABLE `PenaltyState_new` RENAME TO `PenaltyState`;
