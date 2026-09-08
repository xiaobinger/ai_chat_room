-- Message 加 mentionRoles：存储人类发言中 @点名的角色 id
ALTER TABLE `Message`
  ADD COLUMN `mentionRoles` JSON NULL AFTER `content`;
