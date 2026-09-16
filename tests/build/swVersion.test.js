import { describe, it, expect } from 'vitest';
import { stampCache } from '../../build/swVersion.js';

const sw = (name) => `// header\nconst CACHE = '${name}';\nconst SHELL = ['/'];\n`;

describe('stampCache', () => {
	it('replaces the cache name with the app version so every build installs a fresh worker', () => {
		const out = stampCache(sw('coevta-tasks-dev'), '0.0.0.20260916123813');

		expect(out).toContain("const CACHE = 'coevta-tasks-0.0.0.20260916123813';");
		expect(out).not.toContain('coevta-tasks-dev');
	});

	it('leaves the rest of the worker untouched', () => {
		const out = stampCache(sw('coevta-tasks-dev'), '1.2.3');

		expect(out.startsWith('// header\n')).toBe(true);
		expect(out).toContain("const SHELL = ['/'];");
	});

	it('keeps the coevta-tasks- prefix the activate handler filters on', () => {
		const out = stampCache(sw('coevta-tasks-dev'), '1.2.3');

		expect(out).toMatch(/const CACHE = 'coevta-tasks-[^']+';/);
	});

	it('throws when the worker has no CACHE line, because a silent no-op would ship a stale cache', () => {
		expect(() => stampCache('const NOPE = 1;', '1.2.3')).toThrow(/CACHE/);
	});
});
