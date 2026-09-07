-- Membership 加 nickname：成员在房间内的面具昵称
ALTER TABLE `Membership`
  ADD COLUMN `nickname` VARCHAR(64) NULL AFTER `mutedUntilRound`;
