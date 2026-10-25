// How the browser suites reach the app's controls, wherever the layout has
// put them. The top bar folds controls into its ⋯ menu as it narrows, the
// build settings live in a popover, and a view's details in its Options
// menu: a suite that asks for a control by these helpers keeps working when
// the layout moves it, and says which control it could not find when not.

/**
 * Opens the ⋯ menu of the top bar, if it is not open, and returns it.
 * @param {import('playwright-core').Page} page
 */
export async function openMore(page) {
	const menu = page.locator('#more-menu');
	if (!(await menu.evaluate((m) => m.matches(':popover-open')))) await page.locator('header button.more').click();
	await menu.waitFor({ state: 'visible' });
	return menu;
}

/**
 * Closes whatever popover is open (the ⋯ menu, Build settings, a view's
 * Options) as Escape does, and waits until none is.
 * @param {import('playwright-core').Page} page
 */
export async function closePopovers(page) {
	for (let i = 0; i < 3 && (await page.evaluate(() => document.querySelector(':popover-open') !== null)); i++) await page.keyboard.press('Escape');
}

/**
 * The item of the ⋯ menu whose text starts with `name` (the menu is opened
 * first). Only an item shown in the menu: one whose control is in the bar
 * at this width is not.
 * @param {import('playwright-core').Page} page
 * @param {string | RegExp} name
 */
export async function menuItem(page, name) {
	const menu = await openMore(page);
	const text = typeof name === 'string' ? new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : name;
	return menu.locator('[role=menuitem], [role=menuitemcheckbox]').filter({ hasText: text }).filter({ visible: true }).first();
}

/**
 * Opens the Build settings popover, from its chip in the bar or, where the
 * bar has folded the chip, from ⋯ → Build settings…, and returns it.
 * @param {import('playwright-core').Page} page
 */
export async function openBuildSettings(page) {
	const popover = page.locator('#build-settings');
	if (await popover.evaluate((p) => p.matches(':popover-open'))) return popover;
	const chip = page.locator('header .build-chip');
	if (await chip.isVisible()) await chip.click();
	else await (await menuItem(page, 'Build settings')).click();
	await popover.waitFor({ state: 'visible' });
	return popover;
}

/**
 * A field of the Build settings, the popover opened first: the `select` of
 * target, optimization or framework, or the group of sanitizers or of run
 * options (their checkboxes and fields are inline in the popover).
 * @param {import('playwright-core').Page} page
 * @param {'target' | 'optimization' | 'framework' | 'sanitizers' | 'run-options'} which
 */
export async function buildSetting(page, which) {
	const popover = await openBuildSettings(page);
	if (which === 'sanitizers') return popover.locator('.sanitizers');
	if (which === 'run-options') return popover.locator('.run-options');
	return popover.locator(`.row.${which} select`);
}

/**
 * Shows or hides the LLVM IR or Assembly view, by its button in the bar or,
 * where that is folded, by its entry in ⋯.
 * @param {import('playwright-core').Page} page
 * @param {'ir' | 'asm'} kind
 */
export async function toggleView(page, kind) {
	const view = kind === 'ir' ? 'llvm-ir' : 'asm';
	const button = page.locator(`header .view-group button[data-view=${view}]`);
	if (await button.isVisible()) await button.click();
	else {
		// A checkbox item leaves the menu open, for another choice; the caller wants it shut.
		await (await openMore(page)).locator(`[role=menuitemcheckbox][data-view=${view}]`).click();
		await closePopovers(page);
	}
}

/**
 * Opens a view's Options menu and reads what it says about the build:
 * the target triple, the flags (the `clang …` command, from the title) and
 * the flags the user chose. Leaves the menu open.
 * @param {import('playwright-core').Page} page
 * @param {'ir' | 'asm'} kind
 * @returns {Promise<{ triple: string, flags: string, command: string, userFlags: string }>}
 */
export async function viewDetails(page, kind) {
	const view = page.locator(`.yk-view[data-view="${kind === 'ir' ? 'llvm-ir' : 'asm'}"]`);
	const menu = view.locator('.yk-view-menu');
	if (!(await menu.evaluate((m) => m.matches(':popover-open')))) await view.locator('.yk-view-more').click();
	await menu.waitFor({ state: 'visible' });
	const triple = ((await menu.locator('.yk-view-triple').textContent()) ?? '').trim();
	const command = (await menu.locator('.yk-view-flags').getAttribute('title')) ?? '';
	const flags = ((await menu.locator('.yk-view-flags').textContent()) ?? '').trim();
	const userFlags = ((await menu.locator('.yk-view-user-flags').textContent()) ?? '').trim();
	return { triple, flags, command, userFlags };
}

/**
 * Replaces the current language's project with its sample: ⋯ → Reset
 * project…, accepting the confirmation.
 * @param {import('playwright-core').Page} page
 */
export async function resetProject(page) {
	page.once('dialog', (d) => void d.accept());
	await (await menuItem(page, 'Reset project')).click();
}

/**
 * The dock's layout mode (wide, medium or narrow), as the dock last decided it.
 * @param {import('playwright-core').Page} page
 * @returns {Promise<string | undefined>}
 */
export async function layoutMode(page) {
	return page.evaluate(() => document.querySelector('[data-layout-mode]')?.getAttribute('data-layout-mode') ?? undefined);
}
