-- 狼人杀增强：添加法官模式字段（owner=房主当法官；ai=AI法官自动发号）

ALTER TABLE `Room`
  ADD COLUMN `judgeMode` ENUM('owner', 'ai') NULL;
