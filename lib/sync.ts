import type { AppSettings, LocalCard, SyncResponse } from './domain';
import { applySync, getPendingReviews, getSettings, saveSettings } from './db';
import { newFsrsCard } from './fsrs';

type PairingPayload = {
  version: 1;
  endpoint: string;
  token: string;
  transport: 'bridge';
};

export async function beginBridgeSync(settings: AppSettings): Promise<never> {
  if (!settings.endpoint || !settings.token) throw new Error('先にAnkiアドオンのQRコードを読み取ってください。');
  const reviews = await getPendingReviews();
  const request = {
    version: 1,
    token: settings.token,
    returnUrl: `${window.location.origin}${window.location.pathname}`,
    body: { deviceId: settings.deviceId, cursor: settings.syncCursor, reviews },
  };
  const encoded = await encodeCompressed(request);
  window.location.assign(`${settings.endpoint.replace(/\/$/, '')}/bridge#${encoded}`);
  return new Promise<never>(() => undefined);
}

export async function consumeStartupLink(): Promise<
  | { kind: 'paired'; settings: AppSettings }
  | { kind: 'synced'; cards: number; reviews: number; settings: AppSettings }
  | null
> {
  const hash = window.location.hash;
  const bridgeError = new URLSearchParams(window.location.search).get('bridgeError');
  if (bridgeError) {
    clearTransferUrl();
    throw new Error(bridgeError);
  }
  if (hash.startsWith('#pair=')) {
    const settings = await pairFromUrl(window.location.href);
    clearTransferUrl();
    return { kind: 'paired', settings };
  }
  if (window.location.search.includes('bridge=1') && hash.length > 1) {
    const payload = await decodeCompressed<SyncResponse>(hash.slice(1));
    const settings = await getSettings();
    const result = await importSyncPayload(settings, payload);
    clearTransferUrl();
    return { kind: 'synced', ...result };
  }
  return null;
}

export async function pairFromUrl(value: string): Promise<AppSettings> {
  const url = new URL(value);
  if (url.origin !== window.location.origin || !url.hash.startsWith('#pair=')) {
    throw new Error('αnkiアドオンが表示したQRコードではありません。');
  }
  const payload = decodePlain<PairingPayload>(url.hash.slice('#pair='.length));
  if (payload.version !== 1 || payload.transport !== 'bridge' || !payload.token) {
    throw new Error('このQRコードは使用できません。');
  }
  const current = await getSettings();
  const settings: AppSettings = {
    ...current,
    endpoint: normalizeEndpoint(payload.endpoint),
    token: payload.token,
    transport: 'bridge',
  };
  await saveSettings(settings);
  return settings;
}

async function importSyncPayload(settings: AppSettings, payload: SyncResponse) {
  const receivedAt = new Date().getTime();
  const cards: LocalCard[] = payload.cards.map((card) => ({
    id: `anki-${card.id}`,
    ankiCardId: card.id,
    deckId: String(card.deckId),
    deckName: card.deckName,
    front: card.question,
    back: card.answer,
    tags: card.tags,
    // The add-on has already selected these cards with Anki's `is:due` query.
    // Do not compare the Windows timestamp with the iPhone clock again.
    dueAt: receivedAt - 1,
    dueFromAnki: true,
    updatedAt: card.updatedAt,
    fsrs: newFsrsCard(new Date(receivedAt)),
  }));
  const nextSettings = { ...settings, syncCursor: payload.cursor, lastSyncAt: new Date().getTime() };
  await applySync(cards, payload.deletedCardIds, payload.acceptedReviewIds, payload.rejectedReviews, nextSettings);
  return { cards: cards.length, reviews: payload.acceptedReviewIds.length, settings: nextSettings };
}

function normalizeEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('同期先アドレスが不正です。');
  return url.origin;
}

function clearTransferUrl() {
  const search = new URLSearchParams(window.location.search);
  search.delete('bridge');
  search.delete('bridgeError');
  const query = search.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

function decodePlain<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as T;
}

async function encodeCompressed(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (!('CompressionStream' in window)) return `j.${bytesToBase64Url(bytes)}`;
  const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return `z.${bytesToBase64Url(new Uint8Array(compressed))}`;
}

async function decodeCompressed<T>(value: string): Promise<T> {
  const [format, encoded] = value.split('.', 2);
  const bytes = base64UrlToBytes(encoded);
  if (format === 'j') return JSON.parse(new TextDecoder().decode(bytes)) as T;
  if (format !== 'z' || !('DecompressionStream' in window)) throw new Error('同期結果を読み取れませんでした。');
  const decompressed = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(decompressed)) as T;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
