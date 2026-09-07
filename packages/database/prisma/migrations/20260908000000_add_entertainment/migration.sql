-- 娱乐空间：新增枚举、Room 字段、GamePlayer 表
-- 注：此迁移通过 prisma db push 应用

-- Room 表新增字段
ALTER TABLE `Room`
  ADD COLUMN `type` ENUM('discussion', 'entertainment') NOT NULL DEFAULT 'discussion' AFTER `description`,
  ADD COLUMN `gameType` ENUM('werewolf', 'murder_mystery', 'who_is_the_thief') NULL AFTER `type`,
  ADD COLUMN `gameStatus` ENUM('waiting', 'ready', 'playing', 'finished') NOT NULL DEFAULT 'waiting' AFTER `gameType`,
  ADD COLUMN `minPlayers` INT NULL AFTER `gameStatus`,
  ADD COLUMN `maxPlayers` INT NULL AFTER `minPlayers`,
  ADD COLUMN `gameState` JSON NULL AFTER `maxPlayers`;

-- 新增索引
ALTER TABLE `Room` ADD INDEX `Room_type_idx` (`type`);
ALTER TABLE `Room` ADD INDEX `Room_gameStatus_idx` (`gameStatus`);

-- GamePlayer 表
CREATE TABLE `GamePlayer` (
  `id` VARCHAR(36) NOT NULL,
  `roomId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NULL,
  `profileId` VARCHAR(36) NULL,
  `nickname` VARCHAR(64) NOT NULL,
  `role` ENUM('human', 'ai') NOT NULL,
  `isAlive` BOOLEAN NOT NULL DEFAULT TRUE,
  `gameData` JSON NULL,
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GamePlayer_roomId_userId_key` (`roomId`, `userId`),
  INDEX `GamePlayer_roomId_idx` (`roomId`),
  CONSTRAINT `GamePlayer_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room` (`id`) ON DELETE CASCADE,
  CONSTRAINT `GamePlayer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE,
  CONSTRAINT `GamePlayer_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `AgentProfile` (`id`) ON DELETE SET NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
