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

describe('accessibility floor', () => {
	it('gives focus a visible ring rather than a background tint alone', () => {
		expect(read('base.css')).toMatch(/:focus-visible\s*\{[^}]*outline:/);
	});

	it('honours prefers-reduced-motion, so motion is never forced on anyone', () => {
		expect(read('base.css')).toContain('prefers-reduced-motion');
	});
});
