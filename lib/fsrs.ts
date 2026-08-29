import { createEmptyCard, fsrs, Rating, type Card, type CardInput, type Grade } from 'ts-fsrs';
import type { RatingValue } from './domain';

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
});

export function newFsrsCard(now = new Date()): CardInput {
  const card = createEmptyCard(now);
  return serializeCard(card);
}

export function scheduleCard(card: CardInput, rating: RatingValue, now = new Date()) {
  const result = scheduler.next(card, now, rating as Grade);
  return {
    card: serializeCard(result.card),
    intervalLabel: formatInterval(result.card.due.getTime() - now.getTime()),
  };
}

export function previewIntervals(card: CardInput, now = new Date()) {
  const preview = scheduler.repeat(card, now);
  return {
    1: formatInterval(preview[Rating.Again].card.due.getTime() - now.getTime()),
    2: formatInterval(preview[Rating.Hard].card.due.getTime() - now.getTime()),
    3: formatInterval(preview[Rating.Good].card.due.getTime() - now.getTime()),
    4: formatInterval(preview[Rating.Easy].card.due.getTime() - now.getTime()),
  } as const;
}

function serializeCard(card: Card): CardInput {
  return {
    ...card,
    due: card.due.getTime(),
    last_review: card.last_review?.getTime() ?? null,
  } as CardInput;
}

export function formatInterval(milliseconds: number) {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}日`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}か月`;
  return `${Math.round(months / 12)}年`;
}
