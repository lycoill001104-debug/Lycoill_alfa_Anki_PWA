import type { CardInput } from 'ts-fsrs';

export type RatingValue = 1 | 2 | 3 | 4;

export interface DeckRecord {
  id: string;
  name: string;
  updatedAt: number;
}

export interface LocalCard {
  id: string;
  ankiCardId?: number;
  deckId: string;
  deckName?: string;
  front: string;
  back: string;
  tags: string[];
  dueAt: number;
  dueFromAnki?: boolean;
  updatedAt: number;
  fsrs: CardInput;
}

export interface ReviewEvent {
  id: string;
  cardId: string;
  ankiCardId?: number;
  rating: RatingValue;
  reviewedAt: number;
  durationMs: number;
  before: CardInput;
  after: CardInput;
  syncedAt?: number;
  syncError?: string;
}

export interface AppSettings {
  id: 'app';
  endpoint: string;
  token: string;
  deviceId: string;
  syncCursor: string;
  transport?: 'bridge' | 'direct';
  lastSyncAt?: number;
}

export interface SyncCardPayload {
  id: number;
  deckId: number;
  deckName: string;
  question: string;
  answer: string;
  tags: string[];
  dueAt: number;
  updatedAt: number;
}

export interface SyncResponse {
  cursor: string;
  serverTime: number;
  cards: SyncCardPayload[];
  deletedCardIds: number[];
  acceptedReviewIds: string[];
  rejectedReviews: Array<{ id: string; reason: string }>;
}
