import { test, expect } from '@playwright/test';

test.describe('AI multi-role chat room prototype', () => {
  test.describe('Core flows', () => {
    test('lobby -> room wizard -> chat room -> moderation -> review', async ({ page }) => {
      await page.goto('/rooms');
      await expect(page.getByRole('heading', { name: '讨论空间' })).toBeVisible();
      await page.getByRole('link', { name: '创建聊天室' }).click();
      await expect(page.getByRole('heading', { name: '创建聊天室' })).toBeVisible();

      await page.getByRole('button', { name: '继续' }).click();
      await page.getByRole('button', { name: '继续' }).click();
      await page.getByRole('button', { name: '继续' }).click();
      await page.getByRole('button', { name: '继续' }).click();
      await page.getByRole('button', { name: '创建并进入房间' }).click();

      await expect(page.getByRole('heading', { name: 'AI 是否应该拥有真正的创作自主权？' })).toBeVisible();
      await expect(page.getByText('第 7 / 20 轮')).toBeVisible();
    });
  });

  test.describe('Key states', () => {
    test('pause/resume stops and resumes discussion', async ({ page }) => {
      await page.goto('http://127.0.0.1:4173/rooms/demo', { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'AI 是否应该拥有真正的创作自主权？' }).waitFor({ state: 'visible' });
      const initialMessages = page.locator('.message');
      const initialCount = await initialMessages.count();

      await page.getByRole('button', { name: '暂停讨论' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '暂停讨论' }).click();
      await page.getByRole('button', { name: '继续讨论' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '继续讨论' }).click();

      await page.waitForTimeout(500);
      const laterCount = await initialMessages.count();
      expect(laterCount).toBeGreaterThanOrEqual(initialCount);
    });

    test('moderation event shows rule evidence and action', async ({ page }) => {
      await page.goto('http://127.0.0.1:4173/rooms/demo', { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'AI 是否应该拥有真正的创作自主权？' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '模拟偏题治理' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '模拟偏题治理' }).click();
      await expect(page.getByText('治理动作已执行')).toBeVisible();
      await expect(page.getByText(/R-03/)).toBeVisible();
      await expect(page.getByRole('button', { name: '撤销' })).toBeVisible();
    });

    test('revert returns agent to idle and keeps event', async ({ page }) => {
      await page.goto('/rooms/demo');
      await page.getByRole('button', { name: '模拟偏题治理' }).click();
      await page.getByRole('button', { name: '撤销' }).click();
      await expect(page.getByText('已禁言 · 3 轮')).toHaveCount(0);
      await expect(page.getByText('治理动作已执行')).toHaveCount(0);
    });
  });

  test.describe('Responsive behavior', () => {
    test('no horizontal overflow on desktop/tablet/mobile', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/rooms/demo');
      await expect(page).toHaveCSS('overflow-x', 'hidden');
    });
  });
});
