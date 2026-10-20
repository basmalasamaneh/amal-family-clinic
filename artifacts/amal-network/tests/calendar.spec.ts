import { test, expect } from '@playwright/test';

// Default to playwright.config.ts's app origin; override with
// CALENDAR_TEST_BASE_URL when the running dev preview is hosted elsewhere.
if (process.env.CALENDAR_TEST_BASE_URL) {
  test.use({ baseURL: process.env.CALENDAR_TEST_BASE_URL });
}

const dayFixture = '/desk/today?date=2025-03-10&shellDemo=front-desk';
const frontDesk = '/desk/today?shellDemo=front-desk';
const cards = '[data-testid^="card-appointment-"]';
const slots = '[data-testid^="slot-"]';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('amal.tour.v1:fixture%3Afront-desk:front-desk', 'dismissed'));
});

test('date navigation, date input, filter, seven-day week, and selected-day return', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(frontDesk);
  const date = page.getByTestId('input-date');
  const initial = await date.inputValue();
  await page.getByTestId('button-date-next').click();
  await expect(date).not.toHaveValue(initial);
  await page.getByTestId('button-date-prev').click();
  await expect(date).toHaveValue(initial);
  await page.getByTestId('button-date-today').click();
  await expect(page.getByTestId('button-date-today')).toHaveAttribute('aria-pressed', 'true');

  await date.fill('2025-03-10');
  await expect(date).toHaveValue('2025-03-10');
  await page.getByTestId('select-doctor').selectOption('9100101');
  await expect(page).toHaveURL(/doctor=9100101/);
  await page.getByTestId('link-view-week').click();
  await expect(page.getByTestId('calendar-week')).toBeVisible();
  await expect(page.locator('[data-testid^="week-day-"]')).toHaveCount(7);
  await expect(page).toHaveURL(/date=2025-03-10.*doctor=9100101/);
  await page.getByTestId('link-week-day-2025-03-10').click();
  await expect(page.getByTestId('calendar-day')).toBeVisible();
  await expect(page).toHaveURL(/date=2025-03-10.*doctor=9100101/);
  await expect(page.getByTestId('column-doctor-9100101')).toBeVisible();
});

test('all six statuses and overlapping appointments remain independently focusable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(dayFixture);
  await expect(page.getByTestId('calendar-day')).toBeVisible();
  for (const status of ['completed', 'booked', 'conflict', 'noshow', 'sync', 'cancelled']) {
    await expect(page.locator(`.cal-card--${status}`).first()).toBeVisible();
  }

  const booked = page.getByTestId('card-appointment-9102603101');
  const conflict = page.getByTestId('card-appointment-9102603102');
  await expect(booked).toBeVisible();
  await expect(conflict).toBeVisible();
  // Card activation may open the cancellation dialog; Escape closes it and restores focus.
  for (const card of [booked, conflict]) {
    await card.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card).toBeFocused();
  }
});

test('new booking, open-slot, and walk-in open the three-stage drawer with context (fixture, nothing saved)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/desk/today?date=2025-03-10&doctor=9100101&shellDemo=front-desk');
  await expect(page.getByTestId('calendar-day')).toBeVisible();
  await page.getByTestId('link-new-booking').click();
  await expect(page).toHaveURL(/clinic=91001.*source=phone.*doctor=9100101.*date=2025-03-10/);
  const drawer = page.getByTestId('drawer-booking');
  await expect(drawer).toHaveAttribute('data-source', 'phone');
  await expect(drawer.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(drawer.locator('.bk-step')).toHaveCount(3);
  // Fixture sessions are labelled; nothing implies a real write.
  await expect(page.getByTestId('status-fixture-patients')).toBeVisible();
  await expect(page.getByTestId('status-fixture-writes')).toBeVisible();
  await expect(page.getByTestId('button-stage-next')).toBeDisabled();
  await page.getByTestId('input-patient-search').fill('محمد احمد');
  await expect(page.locator('[data-testid^="option-patient-"]')).toHaveCount(2);
  await page.getByTestId('option-patient-9001').click();
  await expect(page.getByTestId('select-booking-doctor')).toHaveValue('9100101');
  await expect(page.getByTestId('input-booking-date')).toHaveValue('2025-03-10');
  await page.getByTestId('button-stage-back').click();
  await expect(page.getByTestId('card-selected-patient')).toContainText('محمد أحمد');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId('calendar-day')).toBeVisible();

  await page.goto(dayFixture);
  await page.getByTestId('slot-9100101-480').click();
  await expect(page.getByTestId('drawer-booking')).toBeVisible();
  await page.getByTestId('input-patient-search').fill('ليلى');
  await page.getByTestId('option-patient-9006').click();
  await expect(page.getByTestId('input-booking-time')).toHaveValue('08:00');
  await expect(page.getByTestId('select-booking-doctor')).toHaveValue('9100101');

  await page.goto(frontDesk);
  await page.getByTestId('link-walk-in').click();
  await expect(page.getByTestId('drawer-booking')).toHaveAttribute('data-source', 'walk-in');
  await expect(page.getByTestId('status-fixture-writes')).toBeVisible();
});

test('explicit empty, no-doctors, error/retry, and no-hours fixtures', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/desk/today?calendarDemo=no-doctors&shellDemo=front-desk');
  await expect(page.getByTestId('state-no-doctors')).toBeVisible();
  await expect(page.locator(cards)).toHaveCount(0);
  await expect(page.locator(slots)).toHaveCount(0);

  await page.goto('/desk/today?calendarDemo=empty&shellDemo=front-desk');
  await expect(page.getByTestId('state-no-appointments')).toBeVisible();
  await expect(page.locator(cards)).toHaveCount(0);
  await expect(page.locator(slots)).toHaveCount(48);

  await page.goto('/desk/today?calendarDemo=error&shellDemo=front-desk');
  await expect(page.getByTestId('state-calendar-error')).toBeVisible();
  await page.getByTestId('button-calendar-retry').click();
  await expect(page.getByTestId('state-calendar-error')).toBeVisible();
  await expect(page.locator(cards)).toHaveCount(0);
  await expect(page.locator(slots)).toHaveCount(0);

  await page.goto('/desk/today?calendarDemo=no-hours&shellDemo=front-desk');
  await expect(page.getByTestId('status-no-hours')).toBeVisible();
  await expect(page.locator(cards).first()).toBeVisible();
  await expect(page.locator(slots)).toHaveCount(0);
});

test('slow date change discards the earlier response', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/desk/today?date=2025-03-10&calendarDemo=slow&shellDemo=front-desk');
  await expect(page.getByTestId('state-calendar-loading')).toBeVisible();
  await page.getByTestId('button-date-next').click();
  await expect(page.getByTestId('input-date')).toHaveValue('2025-03-11');
  await expect(page.getByTestId('calendar-day')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('card-appointment-9102603110')).toBeVisible();
  await expect(page.getByTestId('input-date')).toHaveValue('2025-03-11');
});

test('mobile Walk-in stays visible above bottom navigation; English/dark preferences work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(frontDesk);
  const walkIn = page.getByTestId('link-walk-in');
  const bottomNav = page.getByTestId('nav-bottom');
  await expect(walkIn).toBeVisible();
  const geometry = await page.evaluate(() => {
    const walk = document.querySelector('[data-testid="link-walk-in"]')!.getBoundingClientRect();
    const nav = document.querySelector('[data-testid="nav-bottom"]')!.getBoundingClientRect();
    return { walkBottom: walk.bottom, navTop: nav.top, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  expect(geometry.walkBottom).toBeLessThan(geometry.navTop);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  await page.getByTestId('button-user-menu').click();
  const dialog = page.getByTestId('dialog-user');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('button-locale-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await dialog.getByTestId('button-theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Walk-in is front-desk-only and absent from doctor, admin, and login shells', async ({ page }) => {
  await page.goto(frontDesk);
  await expect(page.getByTestId('link-walk-in')).toBeVisible();
  for (const role of ['doctor', 'admin']) {
    await page.goto(`/desk/today?shellDemo=${role}`);
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-role', role);
    await expect(page.getByTestId('link-walk-in')).toHaveCount(0);
  }
  await page.goto('/login?shellDemo=signed-out');
  await expect(page.getByTestId('page-login')).toBeVisible();
  await expect(page.getByTestId('link-walk-in')).toHaveCount(0);
});
