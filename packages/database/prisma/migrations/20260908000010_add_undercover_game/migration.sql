-- 娱乐空间：新增"谁是卧底"游戏类型
-- 注：此迁移通过 prisma db push / migrate deploy 应用

ALTER TABLE `Room`
  MODIFY COLUMN `gameType` ENUM('werewolf', 'murder_mystery', 'who_is_the_thief', 'who_is_undercover') NULL;
