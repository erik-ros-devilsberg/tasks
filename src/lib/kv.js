/**
 * Storage, narrowed to six methods: get / set / del / all / keys / clear.
 *
 * The narrowness is the point. Two adapters satisfy it — IndexedDB in the
 * browser, a plain Map in tests — which is why every layer above this one can
 * be unit-tested without a DOM and without fake-indexeddb.
 */

const clone = (value) =>
	value === undefined || value === null ? null : JSON.parse(JSON.stringify(value));

export function memoryKv() {
	const map = new Map();

	return {
		async get(key) {
			return map.has(key) ? clone(map.get(key)) : null;
		},
		async set(key, value) {
			map.set(key, clone(value));
		},
		async del(key) {
			map.delete(key);
		},
		async all() {
			return [...map.values()].map(clone);
		},
		async keys() {
			return [...map.keys()];
		},
		async clear() {
			map.clear();
		},
	};
}

/**
 * Every object store this database will ever hold, created together on the one
 * upgrade. The tasks and the outbox live in the same database because they have
 * to be opened at the same version — creating the second one lazily would mean
 * a version bump on a database the first store had already opened.
 */
export const STORES = ['tasks', 'outbox'];

/**
 * The IndexedDB adapter holds no logic beyond translating the six methods into
 * transactions, so it is deliberately not unit-tested — the logic that matters
 * is tested against memoryKv, which satisfies the same contract.
 */
function idbKv(dbName, storeName) {
	let openPromise = null;

	function open() {
		if (!openPromise) {
			openPromise = new Promise((resolve, reject) => {
				const request = indexedDB.open(dbName, 1);

				// Both stores are created on the same upgrade. Opening either one
				// later must not need a version bump, or the second store's first
				// use would fail on a database the first store already created.
				request.onupgradeneeded = () => {
					const db = request.result;

					for (const name of STORES) {
						if (!db.objectStoreNames.contains(name)) {
							db.createObjectStore(name);
						}
					}
				};

				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}

		return openPromise;
	}

	async function run(mode, work) {
		const db = await open();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, mode);
			const request = work(tx.objectStore(storeName));

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	return {
		async get(key) {
			return (await run('readonly', (store) => store.get(key))) ?? null;
		},
		async set(key, value) {
			await run('readwrite', (store) => store.put(clone(value), key));
		},
		async del(key) {
			await run('readwrite', (store) => store.delete(key));
		},
		async all() {
			return (await run('readonly', (store) => store.getAll())) ?? [];
		},
		async keys() {
			return (await run('readonly', (store) => store.getAllKeys())) ?? [];
		},
		async clear() {
			await run('readwrite', (store) => store.clear());
		},
	};
}

/**
 * Falls back to memory rather than throwing. A private window with storage
 * disabled should still give the user a working app for the session — losing
 * the cache is better than a blank screen.
 */
export function createKv(dbName, storeName) {
	if (typeof indexedDB === 'undefined') {
		return memoryKv();
	}

	try {
		return idbKv(dbName, storeName);
	} catch {
		return memoryKv();
	}
}
