import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Entry, Today } from '../../src/shared/schemas.ts';
import { localMinute, localNight, parseLocalMinute, shiftNight } from '../../src/shared/time.ts';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port.');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

const browserTest = test.extend<{ app: { origin: string; token: string } }>({
  context: async ({ playwright }, use, info) => {
    const profile = await mkdtemp(join(tmpdir(), 'tracker-chrome-'));
    const { channel, deviceScaleFactor, hasTouch, isMobile, reducedMotion, userAgent, viewport } = info.project.use;
    const context = await playwright.chromium.launchPersistentContext(profile, {
      channel, deviceScaleFactor, hasTouch, isMobile, reducedMotion, userAgent, viewport, headless: true,
      acceptDownloads: true,
    });
    try {
      await use(context);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
  app: async ({}, use) => {
    const port = await freePort();
    const origin = 'http://127.0.0.1:' + port;
    const directory = await mkdtemp(join(tmpdir(), 'tracker-browser-'));
    const token = randomBytes(32).toString('base64url');
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-transform-types', 'local/server.ts'], {
      env: {
        ...process.env, SLEEP_PROFILE: 'synthetic', SLEEP_PORT: String(port),
        SLEEP_DB: join(directory, 'synthetic.sqlite'), SLEEP_MCP_TOKEN: token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopped = new Promise<number | null>(resolve => child.once('exit', resolve));
    try {
      await expect.poll(async () => {
        try { return (await fetch(origin)).status; } catch { return 0; }
      }).toBe(200);
      await use({ origin, token });
    } finally {
      child.kill('SIGTERM');
      await stopped;
      await rm(directory, { recursive: true, force: true });
    }
  },
});

async function accessible(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), label).toEqual([]);
}

async function download(page: Page, format: 'JSON' | 'CSV') {
  const [result] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download ' + format, exact: true }).click(),
  ]);
  expect(result.suggestedFilename()).toMatch(/^sleep-export-\d{4}-\d{2}-\d{2}\.(json|csv)$/);
  const path = await result.path();
  if (!path) throw new Error('Browser download was not saved.');
  return readFile(path, 'utf8');
}

browserTest('authenticated check-ins, history, goals, exports, MCP, and installable shell', async ({ page, context, app }, info) => {
  const { origin, token } = app;
  const errors: string[] = [];
  const external: string[] = [];
  let intentionallyOffline = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    // Chrome is expected to log a 401 when the synthetic session is absent.
    if (message.type() !== 'error' || message.text().includes('401 (Unauthorized)')) return;
    if (intentionallyOffline && message.text().includes('net::ERR_INTERNET_DISCONNECTED')) return;
    errors.push(message.text());
  });
  page.on('request', request => {
    if (!request.url().startsWith(origin + '/')) external.push(request.url());
  });

  await test.step('authorize from the browser and show genuine empty states', async () => {
    await page.goto(origin);
    expect((await page.request.get(origin + '/api/export?format=json')).status()).toBe(401);
    await page.getByRole('button', { name: 'Open synthetic tracker' }).click();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expect(page.getByText('No active targets.')).toBeVisible();
    await expect(page.locator('.check-in-hero')).toContainText('Evening check-in');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(info.project.use.viewport?.width);
    const shortControls = await page.locator('main button, main .text-button, nav a').evaluateAll(
      elements => elements.filter(element => element.getBoundingClientRect().height < 44).map(element => element.textContent),
    );
    expect(shortControls).toEqual([]);
    await page.screenshot({ path: info.outputPath('today-evening.png'), scale: 'css' });
    await accessible(page, 'Today');
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No check-ins in this range' })).toBeVisible();
    await page.getByRole('link', { name: 'Goals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Seven-day baseline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set targets' })).toHaveCount(0);
  });

  const date = localNight(Date.now());
  let quickBed: Entry;
  let quickWake: Entry;
  let editedBedTime: string;

  await test.step('save the exact time, persist on reload, and promote morning automatically', async () => {
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    const start = Date.now();
    const [response] = await Promise.all([
      page.waitForResponse(result => result.url().endsWith('/api/check-ins/now')),
      page.getByRole('button', { name: 'Log now for evening check-in' }).click(),
    ]);
    expect(response.status()).toBe(201);
    quickBed = (await response.json()).entry;
    expect(Date.parse(quickBed.at)).toBeGreaterThanOrEqual(start - 1000);
    expect(Date.parse(quickBed.at)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(quickBed.mood).toBeNull();
    await expect(page.getByText('Bedtime saved at', { exact: false })).toBeVisible();
    await expect(page.locator('.check-in-hero')).toContainText('Morning check-in');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('today-morning.png'), scale: 'css' });
    await page.reload();
    await expect(page.locator('.check-in-hero')).toContainText('Morning check-in');
    await expect(page.getByRole('button', { name: 'Edit check-in for evening check-in' })).toBeVisible();
    const [wakeResponse] = await Promise.all([
      page.waitForResponse(result => result.url().endsWith('/api/check-ins/now')),
      page.getByRole('button', { name: 'Log now for morning check-in' }).click(),
    ]);
    expect(wakeResponse.status()).toBe(201);
    quickWake = (await wakeResponse.json()).entry;
    expect(quickWake.night).toBe(quickBed.night);
    await expect(page.getByText('Wake time saved at', { exact: false })).toBeVisible();

    const duplicate = await page.request.post(origin + '/api/check-ins/now', {
      data: { night: quickBed.night, kind: quickBed.kind }, headers: { Origin: origin },
    });
    expect(duplicate.status()).toBe(200);
    expect(await duplicate.json()).toMatchObject({ created: false, entry: { at: quickBed.at } });
  });

  await test.step('edit a saved time and add a backdated night with optional details', async () => {
    await page.getByRole('link', { name: 'History', exact: true }).click();
    const editor = page.getByRole('dialog');
    await page.getByRole('button', { name: /Edit check-in for evening/ }).click();
    editedBedTime = localMinute(Date.parse(quickBed.at) - 60_000);
    await editor.getByLabel('Recorded date and time').fill(editedBedTime);
    await editor.getByRole('button', { name: 'Save check-in' }).click();
    await expect(editor).toHaveCount(0);
    const row = page.getByRole('button', { name: /Edit check-in for morning/ });
    await row.click();
    await editor.getByText('Optional details').click();
    await editor.getByLabel('Mood', { exact: true }).selectOption('Calm');
    await editor.getByLabel('Nightmare', { exact: true }).selectOption('No');
    const [width, height] = [info.project.use.viewport!.width, info.project.use.viewport!.height];
    if (width < 400) {
      await page.setViewportSize({ width, height: 490 });
      await editor.getByLabel('Recorded date and time').focus();
      await expect(editor.getByLabel('Recorded date and time')).toBeFocused();
      const saveOnShortScreen = editor.getByRole('button', { name: 'Save check-in' });
      await saveOnShortScreen.scrollIntoViewIfNeeded();
      await expect(saveOnShortScreen).toBeInViewport();
      await page.setViewportSize({ width, height });
    }
    await accessible(page, 'Expanded morning editor');
    await page.screenshot({ path: info.outputPath('morning-editor.png'), scale: 'css' });
    await editor.getByRole('button', { name: 'Save check-in' }).click();
    await expect(page.getByText('Check-in saved.', { exact: true })).toBeVisible();
    await expect(page.getByText('Calm · No nightmare reported')).toBeVisible();
    expect(await row.count()).toBe(1);

    const earlier = shiftNight(date, -8);
    await page.getByRole('button', { name: 'Add bedtime' }).click();
    await editor.getByLabel('Night date').fill(earlier);
    await editor.getByLabel('Recorded date and time').fill(shiftNight(earlier, 1) + 'T00:10');
    await editor.getByText('Optional details').click();
    await editor.getByLabel('Bedtime difficulty', { exact: true }).selectOption('Hard to settle');
    await editor.getByRole('button', { name: 'Save check-in' }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole('button', { name: '30 days' }).click();
    await expect(page.getByRole('img', { name: /Bedtimes by night/ })).toBeVisible();
    await expect(page.getByText('Hard to settle')).toBeVisible();
    await expect(page.getByText('Recorded', { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('history.png'), scale: 'css' });
    await accessible(page, 'History');
    await page.getByRole('button', { name: '180 days' }).click();
    await expect(page.getByRole('img', { name: /Bedtimes by night/ })).toBeVisible();
  });

  await test.step('create, edit, and pause a real goal plan', async () => {
    await page.getByRole('link', { name: 'Goals', exact: true }).click();
    await page.getByRole('button', { name: 'Set targets' }).click();
    const editor = page.getByRole('dialog');
    await editor.getByLabel('Bedtime target').fill('00:05');
    await editor.getByLabel('Wake-time target').fill('07:30');
    await editor.getByLabel('Shift in minutes').fill('15');
    await editor.getByRole('button', { name: 'Save targets' }).click();
    await expect(page.getByText('Your targets are saved.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming review' })).toBeVisible();
    await expect(page.getByText('11:50', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply proposed adjustment' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('goals.png'), scale: 'css' });
    await accessible(page, 'Goals');
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await page.getByRole('button', { name: '30 days' }).click();
    await expect(page.getByText('Target in effect', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Goals', exact: true }).click();
    await page.getByRole('button', { name: 'Edit plan' }).click();
    await editor.getByLabel('Review period', { exact: true }).selectOption('monthly');
    await editor.getByLabel('Bedtime target').fill('23:55');
    await editor.getByRole('button', { name: 'Save targets' }).click();
    await expect(page.getByText('Your plan was updated.')).toBeVisible();
    await page.getByRole('button', { name: 'Pause plan' }).click();
    await editor.getByRole('button', { name: 'Confirm pause' }).click();
    await expect(page.getByRole('heading', { name: 'Plan paused' }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Goal history' })).toBeVisible();
    await expect(page.getByText('Plan edited', { exact: true })).toBeVisible();
  });

  await test.step('check both export bytes and prove MCP uses a separate credential', async () => {
    await page.getByRole('link', { name: 'History', exact: true }).click();
    const exported = JSON.parse(await download(page, 'JSON'));
    expect(exported.entries).toHaveLength(3);
    expect(exported.entries.find((entry: Entry) => entry.id === quickBed.id)).toMatchObject({
      at: new Date(parseLocalMinute(editedBedTime)).toISOString(), revision: 2,
    });
    expect(exported.entries.find((entry: Entry) => entry.kind === 'wake')).toMatchObject({
      at: quickWake.at, mood: 'Calm', nightmare: false, revision: 2,
    });
    expect(exported.goals).toHaveLength(3);
    const csv = await download(page, 'CSV');
    expect(csv).toContain('"nightmare","revision"');
    expect(csv).toContain('"goal"');
    expect(csv).toContain('"Calm","","","false"');

    const data = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_sleep_goals', arguments: {} } };
    expect((await page.request.post(origin + '/mcp', { data })).status()).toBe(401);
    expect((await page.request.post(origin + '/mcp', { data, headers: { Authorization: 'Bearer invalid' } })).status()).toBe(401);
    const mcp = await page.request.post(origin + '/mcp', { data, headers: { Authorization: 'Bearer ' + token } });
    expect((await mcp.json()).result.structuredContent.current.status).toBe('paused');
  });

  await test.step('verify the installed app shell and offline privacy controls', async () => {
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    expect(await page.evaluate(() => navigator.serviceWorker.ready.then(worker => worker.scope))).toBe(origin + '/');
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const cdp = await context.newCDPSession(page);
    const install = await cdp.send('Page.getInstallabilityErrors');
    expect(install.installabilityErrors).toEqual([]);
    await cdp.detach();
    const availableCache = await page.evaluate(async () => {
      const keys = await caches.keys();
      const addresses = await Promise.all(keys.map(key => caches.open(key).then(cache => cache.keys())));
      return addresses.flat().map(req => new URL(req.url).pathname).sort();
    });
    expect(availableCache).toEqual(['/offline.css', '/offline.html']);
    intentionallyOffline = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Log now/ })).toHaveCount(0);
    await context.setOffline(false);
    await page.getByRole('link', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    intentionallyOffline = false;
    await expect(page.getByRole('button', { name: 'Edit check-in for morning check-in' })).toBeVisible();
    const signed = await (await page.request.get(origin + '/api/today')).json() as Today;
    expect(signed.wake.entry?.at).toBe(quickWake.at);
    await page.getByRole('button', { name: 'Sign out of synthetic tracker' }).click();
    await expect(page.getByRole('button', { name: 'Open synthetic tracker' })).toBeVisible();
    expect((await page.request.get(origin + '/api/today')).status()).toBe(401);
  });

  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
