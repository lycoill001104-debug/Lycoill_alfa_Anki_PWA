import type { AppSettings, DeckRecord, LocalCard, ReviewEvent } from './domain';

const DB_NAME = 'alpha-anki';
const DB_VERSION = 1;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cards')) {
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('dueAt', 'dueAt');
        cards.createIndex('ankiCardId', 'ankiCardId', { unique: false });
      }
      if (!db.objectStoreNames.contains('reviews')) {
        const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('syncedAt', 'syncedAt');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  return requestResult(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
}

export async function removeLegacyDemoData() {
  const db = await openDatabase();
  const tx = db.transaction(['decks', 'cards', 'reviews'], 'readwrite');
  const cardStore = tx.objectStore('cards');
  const reviewStore = tx.objectStore('reviews');
  const [cards, reviews] = await Promise.all([
    requestResult(cardStore.getAll()) as Promise<LocalCard[]>,
    requestResult(reviewStore.getAll()) as Promise<ReviewEvent[]>,
  ]);
  tx.objectStore('decks').delete('demo');
  cards.filter((card) => /^demo-[1-4]$/.test(card.id) && !card.ankiCardId).forEach((card) => cardStore.delete(card.id));
  reviews.filter((review) => /^demo-[1-4]$/.test(review.cardId) && !review.ankiCardId).forEach((review) => reviewStore.delete(review.id));
  await transactionDone(tx);
}

export async function getDueCards(now = Date.now()): Promise<LocalCard[]> {
  const cards = await readAll<LocalCard>('cards');
  return cards
    .filter((card) => card.dueAt <= now || card.dueFromAnki || (Boolean(card.ankiCardId) && Number(card.fsrs.state) === 0))
    .sort((a, b) => a.dueAt - b.dueAt);
}

export async function getDecks(): Promise<DeckRecord[]> {
  return (await readAll<DeckRecord>('decks')).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export async function saveAnswer(card: LocalCard, event: ReviewEvent) {
  const db = await openDatabase();
  const tx = db.transaction(['cards', 'reviews'], 'readwrite');
  tx.objectStore('cards').put(card);
  tx.objectStore('reviews').put(event);
  await transactionDone(tx);
}

export async function getPendingReviews(): Promise<ReviewEvent[]> {
  const reviews = await readAll<ReviewEvent>('reviews');
  return reviews.filter((review) => !review.syncedAt).sort((a, b) => a.reviewedAt - b.reviewedAt);
}

export async function getReviewCount() { return (await readAll<ReviewEvent>('reviews')).length; }

export async function getSettings(): Promise<AppSettings> {
  const db = await openDatabase();
  const current = await requestResult(db.transaction('settings').objectStore('settings').get('app')) as AppSettings | undefined;
  if (current) return current;
  const settings: AppSettings = { id: 'app', endpoint: '', token: '', deviceId: crypto.randomUUID(), syncCursor: '' };
  await requestResult(db.transaction('settings', 'readwrite').objectStore('settings').put(settings));
  return settings;
}

export async function saveSettings(settings: AppSettings) {
  const db = await openDatabase();
  await requestResult(db.transaction('settings', 'readwrite').objectStore('settings').put(settings));
}

export async function applySync(cards: LocalCard[], deletedAnkiIds: number[], acceptedIds: string[], rejected: Array<{ id: string; reason: string }>, settings: AppSettings) {
  const db = await openDatabase();
  const tx = db.transaction(['cards', 'decks', 'reviews', 'settings'], 'readwrite');
  const cardStore = tx.objectStore('cards');
  const allCards = await requestResult(cardStore.getAll()) as LocalCard[];
  for (const id of deletedAnkiIds) {
    const local = allCards.find((card) => card.ankiCardId === id);
    if (local) cardStore.delete(local.id);
  }
  cards.forEach((card) => {
    cardStore.put(card);
    tx.objectStore('decks').put({ id: card.deckId, name: card.deckName || card.deckId, updatedAt: card.updatedAt } satisfies DeckRecord);
  });
  const now = Date.now();
  for (const id of acceptedIds) {
    const review = await requestResult(tx.objectStore('reviews').get(id)) as ReviewEvent | undefined;
    if (review) tx.objectStore('reviews').put({ ...review, syncedAt: now, syncError: undefined });
  }
  for (const item of rejected) {
    const review = await requestResult(tx.objectStore('reviews').get(item.id)) as ReviewEvent | undefined;
    if (review) tx.objectStore('reviews').put({ ...review, syncError: item.reason });
  }
  tx.objectStore('settings').put(settings);
  await transactionDone(tx);
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
