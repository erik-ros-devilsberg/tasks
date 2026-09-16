import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cssDir = join(process.cwd(), 'public', 'css');
const brandDir = '/home/erik/git/devilsberg-code/private-claude-plugins/devilsberg-brands/brands/devilsberg/css';

const read = (name) => readFileSync(join(cssDir, name), 'utf8');

const brandFiles = [
	'fonts.css',
	'tokens.css',
	'base.css',
	'layout.css',
	'components.css',
	'utilities.css',
	'main.css',
];

describe('stylesheet structure', () => {
	it('keeps main.css to imports only, so the cascade order is the file order', () => {
		const meaningful = read('main.css')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);

		expect(meaningful.every((line) => line.startsWith('@import'))).toBe(true);
	});

	it('imports the brand parts in cascade order', () => {
		const order = [...read('main.css').matchAll(/@import '\.\/(.+?)';/g)].map((m) => m[1]);

		expect(order).toEqual([
			'fonts.css',
			'tokens.css',
			'base.css',
			'layout.css',
			'components.css',
			'utilities.css',
		]);
	});

	it('ships exactly the brand sheets plus one app sheet — nothing else', () => {
		const files = readdirSync(cssDir).filter((name) => name.endsWith('.css')).sort();

		expect(files).toEqual([...brandFiles, 'app.css'].sort());
	});

	it('loads the app sheet after main.css, so the brand never has to be edited', () => {
		const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
		const links = [...html.matchAll(/<link rel="stylesheet" href="\/css\/(.+?)"/g)].map((m) => m[1]);

		expect(links).toEqual(['main.css', 'app.css']);
	});

	it('declares no hardcoded colour outside tokens.css — every colour is a token', () => {
		// app.css may carry its own :root token block; anywhere else is an offence.
		const stripRoot = (css) => css.replace(/:root\s*\{[^}]*\}/g, '');
		const offenders = readdirSync(cssDir)
			.filter((name) => name !== 'tokens.css' && name.endsWith('.css'))
			.filter((name) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(stripRoot(read(name))));

		expect(offenders).toEqual([]);
	});
});

describe('the brand stylesheets are copied, not forked', () => {
	// The plugin is the source of truth. A local edit would be lost on the next
	// copy, so every difference has to live in app.css instead.
	it.each(brandFiles)('%s matches the plugin byte for byte', (name) => {
		expect(read(name)).toBe(readFileSync(join(brandDir, name), 'utf8'));
	});

	it('ships every brand font the sheet declares', () => {
		const fonts = readdirSync(join(process.cwd(), 'public', 'fonts')).sort();

		expect(fonts).toEqual([
			'LEMONMILK-Bold.otf',
			'LEMONMILK-Light.otf',
			'LEMONMILK-Medium.otf',
			'OpenSans-VariableFont_wdth,wght.ttf',
			'Streetag-Regular.ttf',
		]);
	});
});

describe('shared class inventory', () => {
	// These are the classes the views are required to reuse rather than
	// inventing their own. Losing one silently pushes a view into bespoke CSS.
	const required = [
		'.container',
		'.app-main',
		'.app-view',
		'.nav',
		'.nav__brand',
		'.nav__links',
		'.toolbar',
		'.wordmark',
		'.card',
		'.list',
		'.list__header',
		'.list__row',
		'.list__row--overdue',
		'.list__row--today',
		'.list__row--upcoming',
		'.list__row--undated',
		'.list__row--completed',
		'.list__primary',
		'.list__secondary',
		'.form',
		'.field',
		'.field__label',
		'.field__input',
		'.field__error',
		'.field--inline',
		'.btn',
		'.btn--primary',
		'.btn--ghost',
		'.btn--sm',
		'.btn--icon',
		'.btn--fab',
		'.menu',
		'.menu__panel',
		'.menu__item',
		'.footer',
		'.modal',
		'.modal__dialog',
		'.modal__actions',
		'.error',
		'.notice',
		'.is-overdue',
		'.text-muted',
		'.visually-hidden',
		'.mt-2',
	];

	const all = readdirSync(cssDir)
		.filter((name) => name.endsWith('.css'))
		.map(read)
		.join('\n');

	it.each(required)('defines %s', (selector) => {
		expect(all).toContain(`${selector} `);
	});
});

describe('the list runs edge to edge', () => {
	it('pulls the list out of the container gutter, so a row is not inset by it', () => {
		// The row's background is what states its status. Leaving the page colour
		// showing down both sides turns that into a stripe rather than a row.
		expect(read('app.css')).toMatch(/\.list\s*\{[^}]*margin:[^;]*calc\(var\(--container-pad\)\s*\*\s*-1\)/);
	});

	it('keeps a row padded to the container gutter, so the text still lines up', () => {
		expect(read('app.css')).toMatch(/\.list__row\s*\{[^}]*padding:[^;]*var\(--container-pad\)/);
	});
});

describe('native controls', () => {
	it('tells the browser this is a dark app, so date pickers are not drawn for a white one', () => {
		// Without this the calendar widget and its icon come back in the UA's
		// light palette — a dark glyph on a dark field, which reads as a date
		// input that does nothing when you click it.
		expect(read('tokens.css')).toMatch(/color-scheme:\s*dark/);
	});
});

describe('a completed row', () => {
	it('strikes the title through, so a done task is skipped rather than read', () => {
		expect(read('app.css')).toMatch(
			/\.list__row--completed .list__primary\s*\{[^}]*text-decoration:\s*line-through/,
		);
	});

	it('dims the ink rather than leaving it as loud as an open task', () => {
		// Dimmer, not invisible: it still has to clear the contrast floor.
		expect(read('app.css')).toMatch(/--row-completed-ink:\s*var\(--gray-faint\)/);
	});
});

describe('the add button', () => {
	it('is pinned to the screen rather than scrolling away up the page', () => {
		expect(read('app.css')).toMatch(/\.btn--fab\s*\{[^}]*position:\s*fixed/);
	});

	it('clears whatever the device carves out at the bottom', () => {
		expect(read('app.css')).toMatch(/\.btn--fab\s*\{[^}]*safe-area-inset-bottom/);
	});

	it('leaves room under the list so it never covers the last task', () => {
		expect(read('app.css')).toMatch(/\.app-main\s*\{[^}]*padding-bottom/);
	});
});

describe('accessibility floor', () => {
	it('gives focus a visible ring rather than a background tint alone', () => {
		expect(read('base.css')).toMatch(/:focus-visible\s*\{[^}]*outline:/);
	});

	it('honours prefers-reduced-motion, so motion is never forced on anyone', () => {
		expect(read('base.css')).toContain('prefers-reduced-motion');
	});
});
