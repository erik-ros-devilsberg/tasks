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
		'.badge',
		'.badge--pending',
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

describe('the confirm dialog’s buttons', () => {
	it('does not throw a danger button left when it is the dialog’s go button', () => {
		// The brand pushes `.btn--danger` to the far left because it assumes danger is a
		// third, incidental action sitting beside a separate go button — true on the task
		// form, false in this dialog, where Delete *is* the go button. Unoverridden it puts
		// the destructive button on the left and Cancel on the right: backwards.
		expect(read('app.css')).toMatch(
			/\.modal__actions .btn--danger:last-child\s*\{[^}]*margin-right:\s*0/,
		);
	});
});

describe('the nav on a phone', () => {
	// The brand's 768px rule gives .nav__links `width: 100%` and lets the bar
	// wrap, which is right for a row of text links and wrong for one icon
	// button: it drops the hamburger onto a line of its own under the wordmark.
	it('keeps the hamburger on the wordmark’s line instead of wrapping under it', () => {
		const mobile = read('app.css').match(/@media \(max-width: 768px\)\s*\{([\s\S]*?)\n\}/);

		expect(mobile).not.toBeNull();
		expect(mobile[1]).toMatch(/\.nav__links\s*\{[^}]*width:\s*auto/);
		expect(mobile[1]).toMatch(/\.nav__links\s*\{[^}]*margin-left:\s*auto/);
		expect(mobile[1]).toMatch(/\.nav__inner\s*\{[^}]*flex-wrap:\s*nowrap/);
	});
});

describe('the menu overlay', () => {
	// The overlay is fixed to the viewport, so on a wide screen its panel hugs
	// the window edge while the hamburger that opened it sits inboard at the
	// container's edge. Its gutter has to be the container's gutter.
	it('lines its panel up with the container rather than the window', () => {
		expect(read('app.css')).toMatch(
			/\.menu\s*\{[^}]*padding-inline:[^;]*var\(--container-max\)[^;]*var\(--container-pad\)/,
		);
	});
});

describe('the drag handle', () => {
	it('opts out of touch gestures, or a finger on it scrolls the page instead of dragging', () => {
		expect(read('app.css')).toMatch(/\.list__handle\s*\{[^}]*touch-action:\s*none/);
	});

	it('says what it is with the cursor — grab at rest, grabbing while held', () => {
		expect(read('app.css')).toMatch(/\.list__handle\s*\{[^}]*cursor:\s*grab/);
		expect(read('app.css')).toMatch(/\.list__handle:active\s*\{[^}]*cursor:\s*grabbing/);
	});

	it('marks the dragged row and the slot it will land in', () => {
		const css = read('app.css');

		expect(css).toMatch(/\.list__row\.is-dragging\s*\{/);
		expect(css).toMatch(/\.list__row\.is-drop-before\s*\{/);
		expect(css).toMatch(/\.list__row\.is-drop-after\s*\{/);
	});
});

describe('row state', () => {
	it('leaves an open row on the page background, whatever its due state', () => {
		// State by colour read as a telling-off: a screen of red is discouraging
		// exactly where action is wanted. The due date text carries the state
		// instead, so no row is painted and delete mode has nothing to fade.
		const css = read('app.css');

		expect(css).not.toMatch(/--row-bg/);
		expect(css).not.toMatch(/\.list__row--(overdue|today|upcoming|undated)\s*\{/);
	});
});

describe('delete mode', () => {
	it('greys a selected row, because an inset bar alone is too little to pick out at a glance', () => {
		expect(read('app.css')).toMatch(
			/\.list\.is-delete-mode \.list__row[^{]*\.is-selected[^{]*\{[^}]*background-color:\s*var\(--row-selected\)/,
		);
	});

	it('lets a click on the disabled tick fall through to the row, so no part of it is dead', () => {
		expect(read('app.css')).toMatch(/\.list\.is-delete-mode \.tick\s*\{[^}]*pointer-events:\s*none/);
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
