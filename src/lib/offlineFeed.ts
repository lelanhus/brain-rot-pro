import type { Doc } from '$convex/_generated/dataModel';

/**
 * Offline card cache (PWA offline reading). Mirrors the most recent feed into
 * IndexedDB so an installed app launched offline can still show real cards (the
 * service worker serves the cached shell; this provides the content). Read-only:
 * saving/personalizing needs the live Convex connection. Capped so it stays a
 * cache, not a growing store.
 */
const DB_NAME = 'brp-offline';
const STORE = 'cards';
const MAX = 50;

export type OfflineCard = Doc<'knowledgeCards'>;

/** Bound the cache to the freshest N cards (pure → unit-testable). */
export function capCards<T>(cards: readonly T[], max = MAX): T[] {
	return cards.slice(0, max);
}

function available(): boolean {
	return typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** Replace the cache with the current feed (capped), preserving feed order. */
export async function persistCards(cards: readonly OfflineCard[]): Promise<void> {
	if (!available() || cards.length === 0) return;
	const capped = capCards(cards);
	const db = await open();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			const store = tx.objectStore(STORE);
			store.clear();
			capped.forEach((card, i) => store.put(card, i)); // numeric keys keep order
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

/** Read the cached cards back, in feed order. Empty when nothing's cached. */
export async function readCards(): Promise<OfflineCard[]> {
	if (!available()) return [];
	const db = await open();
	try {
		return await new Promise<OfflineCard[]>((resolve, reject) => {
			const tx = db.transaction(STORE, 'readonly');
			const req = tx.objectStore(STORE).getAll();
			req.onsuccess = () => resolve(req.result as OfflineCard[]);
			req.onerror = () => reject(req.error);
		});
	} finally {
		db.close();
	}
}
