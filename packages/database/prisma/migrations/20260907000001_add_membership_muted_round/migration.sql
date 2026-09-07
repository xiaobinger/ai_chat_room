-- Membership 加 mutedUntilRound：支持房主禁言人类成员
ALTER TABLE `Membership`
  ADD COLUMN `mutedUntilRound` INT NULL AFTER `leftAt`;
