-- ModerationAction 加 unmute
ALTER TABLE `ModerationEvent` MODIFY COLUMN `action` ENUM('remind', 'warn', 'mute', 'kick', 'revoke', 'unmute') NOT NULL;
