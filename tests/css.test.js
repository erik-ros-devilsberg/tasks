import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cssDir = join(process.cwd(), 'public', 'css');

const read = (name) => readFileSync(join(cssDir, name), 'utf8');

describe('stylesheet structure', () => {
	it('keeps main.css to imports only, so the cascade order is the file order', () => {
		const meaningful = read('main.css')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);

		expect(meaningful.every((line) => line.startsWith('@import'))).toBe(true);
	});

	it('imports the parts in cascade order', () => {
		const order = [...read('main.css').matchAll(/@import url\('\.\/(.+?)'\)/g)].map((m) => m[1]);

		expect(order).toEqual([
			'tokens.css',
			'base.css',
			'layout.css',
			'components.css',
			'utilities.css',
		]);
	});

	it('declares no hardcoded colour outside tokens.css — every colour is a token', () => {
		const offenders = readdirSync(cssDir)
			.filter((name) => name !== 'tokens.css' && name.endsWith('.css'))
			.filter((name) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(read(name)));

		expect(offenders).toEqual([]);
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
		'.badge',
		'.badge--pending',
		'.conn',
		'.conn--offline',
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
		expect(read('components.css')).toMatch(/\.list\s*\{[^}]*margin:[^;]*calc\(var\(--container-pad\)\s*\*\s*-1\)/);
	});

	it('keeps a row padded to the container gutter, so the text still lines up', () => {
		expect(read('components.css')).toMatch(/\.list__row\s*\{[^}]*padding:[^;]*var\(--container-pad\)/);
	});
});

describe('native controls', () => {
	it('tells the browser this is a dark app, so date pickers are not drawn for a white one', () => {
		// Without this the calendar widget and its icon come back in the UA's
		// light palette — a dark glyph on a dark field, which reads as a date
		// input that does nothing when you click it.
		expect(read('base.css')).toMatch(/color-scheme:\s*dark/);
	});
});

describe('a completed row', () => {
	it('strikes the title through, so a done task is skipped rather than read', () => {
		expect(read('components.css')).toMatch(
			/\.list__row--completed .list__primary\s*\{[^}]*text-decoration:\s*line-through/,
		);
	});

	it('dims the ink rather than leaving it as loud as an open task', () => {
		// Dimmer, not invisible: it still has to clear the contrast floor.
		expect(read('tokens.css')).toMatch(/--row-completed-ink:\s*var\(--gray-faint\)/);
	});
});

describe('the add button', () => {
	it('is pinned to the screen rather than scrolling away up the page', () => {
		expect(read('components.css')).toMatch(/\.btn--fab\s*\{[^}]*position:\s*fixed/);
	});

	it('clears whatever the device carves out at the bottom', () => {
		expect(read('components.css')).toMatch(/\.btn--fab\s*\{[^}]*safe-area-inset-bottom/);
	});

	it('leaves room under the list so it never covers the last task', () => {
		expect(read('layout.css')).toMatch(/\.app-main\s*\{[^}]*padding-bottom/);
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
