'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Database, Download, House, Layers3, LoaderCircle, QrCode, RotateCcw, Settings2, Smartphone, Wifi, WifiOff, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PwaRegister } from './pwa-register';
import { getDecks, getDueCards, getPendingReviews, getReviewCount, getSettings, removeLegacyDemoData, saveAnswer, saveSettings } from '@/lib/db';
import { previewIntervals, scheduleCard } from '@/lib/fsrs';
import { beginBridgeSync, consumeStartupLink, pairFromUrl } from '@/lib/sync';
import type { AppSettings, DeckRecord, LocalCard, RatingValue, ReviewEvent } from '@/lib/domain';

type SyncState = 'idle' | 'syncing' | 'success' | 'error';
type ActiveTab = 'home' | 'decks' | 'settings';
type IntervalPreview = ReturnType<typeof previewIntervals>;

const nowMs = () => new Date().getTime();

const ratingOptions: Array<{ rating: RatingValue; label: string }> = [
  { rating: 1, label: 'Again' },
  { rating: 2, label: 'Hard' },
  { rating: 3, label: 'Good' },
  { rating: 4, label: 'Easy' },
];

export function ReviewerApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [cards, setCards] = useState<LocalCard[]>([]);
  const [decks, setDecks] = useState<DeckRecord[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [reviewedToday, setReviewedToday] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(true);
  const [intervals, setIntervals] = useState<IntervalPreview | null>(null);
  const answerStartedAt = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);

  const reload = useCallback(async () => {
    const [due, savedDecks, queued, reviewCount, savedSettings] = await Promise.all([
      getDueCards(), getDecks(), getPendingReviews(), getReviewCount(), getSettings(),
    ]);
    setCards(due);
    setDecks(savedDecks);
    setPending(queued.length);
    setReviewedToday(reviewCount);
    setSettings(savedSettings);
    setLoading(false);
    answerStartedAt.current = nowMs();
  }, []);

  useEffect(() => {
    queueMicrotask(() => setOnline(navigator.onLine));
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    async function initialize() {
      try {
        await removeLegacyDemoData();
        const startup = await consumeStartupLink();
        await reload();
        if (startup?.kind === 'paired') {
          setSettings(startup.settings);
          setActiveTab('home');
          setSyncState('syncing');
          setMessage('ペアリングしました。Ankiからカードを受信しています…');
          await beginBridgeSync(startup.settings);
        } else if (startup?.kind === 'synced') {
          setSettings(startup.settings);
          setSyncState('success');
          setMessage(`${startup.cards}枚を受信し、${startup.reviews}件の回答を同期しました。`);
        }
      } catch (error) {
        setSyncState('error');
        setMessage(error instanceof Error ? error.message : '起動データを読み取れませんでした。');
        setLoading(false);
      }
    }
    void initialize();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [reload]);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    let cancelled = false;
    let paired = false;
    let pairingStored = false;
    async function startScanner() {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 180 });
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (result, _error, activeControls) => {
            if (!result || paired) return;
            paired = true;
            void pairFromUrl(result.getText()).then(async (pairedSettings) => {
              if (cancelled) return;
              pairingStored = true;
              activeControls.stop();
              scannerControlsRef.current = null;
              setSettings(pairedSettings);
              setScannerOpen(false);
              setSyncState('syncing');
              setMessage('ペアリングしました。Ankiからカードを受信しています…');
              setActiveTab('home');
              await beginBridgeSync(pairedSettings);
            }).catch((error: unknown) => {
              paired = false;
              setSyncState('error');
              const detail = error instanceof Error ? error.message : 'QRコードを読み取れませんでした。';
              if (pairingStored) setMessage(`ペアリングしましたが、自動同期を開始できませんでした。${detail}`);
              else setScannerError(detail);
            });
          },
        );
        if (cancelled) controls.stop();
        else scannerControlsRef.current = controls;
      } catch (error) {
        if (!cancelled) setScannerError(error instanceof Error ? error.message : 'カメラを起動できませんでした。');
      }
    }
    void startScanner();
    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [scannerOpen]);

  function closeScanner() {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    setScannerOpen(false);
    setScannerError('');
  }

  const card = cards[0];

  async function answerCard(rating: RatingValue) {
    if (!card) return;
    const reviewedAt = nowMs();
    const result = scheduleCard(card.fsrs, rating, new Date(reviewedAt));
    const updated: LocalCard = { ...card, fsrs: result.card, dueAt: Number(result.card.due), dueFromAnki: false, updatedAt: reviewedAt };
    const event: ReviewEvent = {
      id: crypto.randomUUID(), cardId: card.id, ankiCardId: card.ankiCardId, rating, reviewedAt,
      durationMs: reviewedAt - answerStartedAt.current, before: card.fsrs, after: result.card,
    };
    await saveAnswer(updated, event);
    setCards((current) => current.slice(1));
    setPending((count) => count + 1);
    setReviewedToday((count) => count + 1);
    setRevealed(false);
    setIntervals(null);
    answerStartedAt.current = nowMs();
  }

  async function saveConnection() {
    if (!settings) return;
    const normalized = {
      ...settings,
      endpoint: settings.endpoint.trim().replace(/\/$/, ''),
      token: settings.token.trim(),
      transport: 'bridge' as const,
    };
    await saveSettings(normalized);
    setSettings(normalized);
    setMessage('接続設定をこのiPhoneに保存しました。');
    setActiveTab('home');
  }

  async function runSync() {
    if (!settings?.endpoint || !settings.token) {
      setActiveTab('settings');
      setSyncState('error');
      setMessage('先にWindows Ankiとペアリングしてください。');
      return;
    }
    setSyncState('syncing');
    setMessage('');
    try {
      await beginBridgeSync(settings);
    } catch (error) {
      setSyncState('error');
      setMessage(error instanceof Error ? error.message : '同期に失敗しました。');
    }
  }

  const homeMode = activeTab === 'home';

  return (
    <main className={`${homeMode ? 'h-dvh overflow-hidden' : 'min-h-dvh'} bg-background text-foreground`}>
      <PwaRegister />
      <div className={`mx-auto w-full max-w-3xl px-4 pt-[env(safe-area-inset-top)] sm:px-8 ${homeMode ? 'flex h-dvh flex-col overflow-hidden pb-[calc(4.6rem+env(safe-area-inset-bottom))]' : 'min-h-dvh pb-[calc(6.25rem+env(safe-area-inset-bottom))]'}`}>
        <header className={`apple-topbar z-20 -mx-4 flex h-14 shrink-0 items-center justify-between px-4 sm:-mx-8 sm:px-8 ${homeMode ? '' : 'sticky top-0'}`}>
          <div><p className="text-[0.68rem] font-semibold tracking-wide text-muted-foreground">αnki</p><h1 className="text-[1.05rem] font-semibold tracking-[-0.02em]">{activeTab === 'home' ? '今日の復習' : activeTab === 'decks' ? 'デッキ' : '設定'}</h1></div>
          {activeTab !== 'settings' && <Button aria-label="Windows Ankiと同期" className="h-9 rounded-full px-4 text-sm font-normal" disabled={syncState === 'syncing'} onClick={runSync}>{syncState === 'syncing' ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />} 同期</Button>}
        </header>

        {message && <div className="apple-notice fixed inset-x-4 top-[calc(env(safe-area-inset-top)+4.25rem)] z-40 mx-auto flex max-w-xl items-center gap-2 rounded-[1.125rem] px-4 py-3 text-sm text-foreground">{syncState === 'error' ? <X className="size-4 shrink-0 text-primary" /> : syncState === 'syncing' ? <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" /> : <Check className="size-4 shrink-0 text-primary" />}<span className="flex-1">{message}</span><button aria-label="閉じる" className="grid size-8 place-items-center rounded-full text-muted-foreground" onClick={() => setMessage('')}><X className="size-4" /></button></div>}

        {activeTab === 'home' && <HomeView card={card} cards={cards} intervals={intervals} loading={loading} online={online} pending={pending} revealed={revealed} reviewed={reviewedToday} paired={Boolean(settings?.token)} syncing={syncState === 'syncing'} onAnswer={answerCard} onReveal={() => { if (card) { setIntervals(previewIntervals(card.fsrs)); setRevealed(true); } }} onSettings={() => setActiveTab('settings')} onSync={runSync} />}
        {activeTab === 'decks' && <DecksView cards={cards} decks={decks} loading={loading} onSync={runSync} />}
        {activeTab === 'settings' && settings && <SettingsView online={online} pending={pending} settings={settings} onChange={setSettings} onSave={saveConnection} onScan={() => { setScannerError(''); setScannerOpen(true); }} />}
      </div>

      <BottomNavigation active={activeTab} onChange={setActiveTab} />

      {scannerOpen && <dialog className="fixed inset-0 z-50 m-0 grid h-dvh max-h-none w-full max-w-none place-items-end bg-black/35 p-0 text-foreground backdrop-blur-sm sm:place-items-center sm:p-4" open aria-labelledby="scanner-title"><section className="w-full max-w-lg overflow-hidden rounded-t-[1.5rem] bg-card p-6 sm:rounded-[1.5rem] sm:p-8"><div className="mb-5 flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Windows Anki</p><h2 className="text-xl font-semibold tracking-[-0.02em]" id="scanner-title">QRコードを読み取る</h2></div><Button aria-label="スキャナーを閉じる" className="rounded-full" onClick={closeScanner} size="icon" variant="secondary"><X /></Button></div><div className="relative aspect-square overflow-hidden rounded-[1.1rem] bg-black"><video className="h-full w-full object-cover" muted playsInline ref={videoRef} /><div className="pointer-events-none absolute inset-[14%] rounded-[1rem] border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" /></div><p className="mt-4 text-center text-sm leading-6 text-muted-foreground">Ankiに表示されたQRコードを枠内に入れてください。</p>{scannerError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{scannerError}</p>}<Button className="mt-5 h-11 w-full rounded-full" onClick={closeScanner} variant="secondary">キャンセル</Button></section></dialog>}
    </main>
  );
}

function HomeView({ card, cards, intervals, loading, online, pending, revealed, reviewed, paired, syncing, onAnswer, onReveal, onSettings, onSync }: { card?: LocalCard; cards: LocalCard[]; intervals: IntervalPreview | null; loading: boolean; online: boolean; pending: number; revealed: boolean; reviewed: number; paired: boolean; syncing: boolean; onAnswer: (rating: RatingValue) => void; onReveal: () => void; onSettings: () => void; onSync: () => void }) {
  return <section className="flex min-h-0 flex-1 flex-col gap-3 py-3" aria-label="カード復習">
    <div className="grid h-[3.25rem] shrink-0 grid-cols-3 rounded-[1.125rem] border border-black/[0.08] bg-card px-2"><Metric label="残り" value={cards.length} /><Metric label="復習済み" value={reviewed} /><Metric label="未同期" value={pending} /></div>
    {loading ? <LoadingCard /> : card ? <>
      <article className="review-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.125rem] border border-black/[0.08] bg-card">
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 px-4">
          <Badge className="max-w-[45%] truncate rounded-full bg-[#fafafc] font-normal text-foreground" variant="secondary">{card.tags[0] ?? 'Anki'}</Badge>
          <span className="truncate text-xs text-muted-foreground">{card.deckName || `Deck ${card.deckId}`}</span>
        </div>
        <div className={`review-spread grid min-h-0 flex-1 ${revealed ? 'grid-rows-2 sm:grid-cols-2 sm:grid-rows-1' : 'grid-rows-1'}`}>
          <section className="flex min-h-0 flex-col px-4 pb-3 pt-2" aria-label="問題">
            <p className="mb-1 shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Question</p>
            <div className="min-h-0 flex-1"><CardFace html={card.front} large /></div>
          </section>
          {revealed && <section className="answer-in flex min-h-0 flex-col border-t border-border px-4 pb-3 pt-2 sm:border-l sm:border-t-0" aria-label="答え">
            <p className="mb-1 shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-primary">Answer</p>
            <div className="min-h-0 flex-1"><CardFace html={card.back} /></div>
          </section>}
        </div>
      </article>
      <div className="h-[3.75rem] shrink-0">
        {!revealed ? <Button className="h-full w-full rounded-full text-[1.05rem] font-normal" onClick={onReveal}>答えを表示</Button> : <div className="grid h-full grid-cols-4 gap-1.5">{ratingOptions.map((option) => <Button aria-label={`${option.label} ${intervals?.[option.rating] ?? ''}`} key={option.rating} className="review-rating h-full min-w-0 flex-col gap-0.5 rounded-[0.7rem] px-1" onClick={() => onAnswer(option.rating)} variant="outline"><span className="text-[0.78rem] font-semibold">{option.label}</span><span className="max-w-full truncate text-[0.62rem] text-muted-foreground">{intervals?.[option.rating]}</span></Button>)}</div>}
      </div>
    </> : <EmptyReview paired={paired} syncing={syncing} onSettings={onSettings} onSync={onSync} />}
    <div className="flex h-4 shrink-0 items-center justify-center gap-1.5 text-[0.65rem] text-muted-foreground">{online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}{online ? (pending ? `${pending}件の回答が同期待ち` : '回答は同期済み') : 'オフラインで復習できます'}</div>
  </section>;
}

function DecksView({ cards, decks, loading, onSync }: { cards: LocalCard[]; decks: DeckRecord[]; loading: boolean; onSync: () => void }) {
  return <section className="py-6"><div className="mb-7"><h2 className="text-3xl font-semibold tracking-[-0.04em]">あなたのデッキ</h2><p className="mt-2 text-[0.95rem] leading-6 text-muted-foreground">Windows Ankiから受信したデッキだけを表示します。</p></div>{loading ? <LoadingCard /> : decks.length ? <div className="overflow-hidden rounded-[1.125rem] border border-black/[0.08] bg-card">{decks.map((deck, index) => { const count = cards.filter((card) => card.deckId === deck.id).length; return <div className={`flex items-center gap-4 p-5 ${index ? 'border-t border-border' : ''}`} key={deck.id}><div className="grid size-11 place-items-center rounded-[0.7rem] bg-[#fafafc] text-primary"><Layers3 className="size-5" /></div><div className="min-w-0 flex-1"><p className="truncate font-semibold tracking-[-0.01em]">{deck.name}</p><p className="mt-1 text-sm text-muted-foreground">復習カード {count}枚</p></div><span className="text-sm font-semibold text-primary">{count}</span></div>; })}</div> : <div className="rounded-[1.125rem] border border-black/[0.08] bg-card px-6 py-14 text-center"><div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-[#fafafc] text-primary"><Layers3 className="size-6" /></div><h3 className="text-lg font-semibold">デッキはまだありません</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Windows Ankiを起動して同期すると、実際のデッキがここに表示されます。</p><Button className="mt-6 rounded-full px-6" onClick={onSync}>Ankiと同期</Button></div>}</section>;
}

function SettingsView({ online, pending, settings, onChange, onSave, onScan }: { online: boolean; pending: number; settings: AppSettings; onChange: (settings: AppSettings) => void; onSave: () => void; onScan: () => void }) {
  const paired = Boolean(settings.endpoint && settings.token);
  return <section className="py-6"><div className="mb-7"><h2 className="text-3xl font-semibold tracking-[-0.04em]">接続</h2><p className="mt-2 text-[0.95rem] leading-6 text-muted-foreground">Windows Ankiと同じWi-Fiでペアリングします。</p></div><div className="rounded-[1.125rem] border border-black/[0.08] bg-card p-5"><div className="flex items-center gap-4"><div className={`grid size-11 place-items-center rounded-full ${paired ? 'bg-[#fafafc] text-primary' : 'bg-muted text-muted-foreground'}`}><Smartphone className="size-5" /></div><div className="flex-1"><p className="font-semibold">{paired ? 'ペアリング済み' : '未接続'}</p><p className="mt-1 text-sm text-muted-foreground">{paired ? `${online ? 'オンライン' : 'オフライン'}・未同期 ${pending}件` : 'QRコードで簡単に接続できます'}</p></div>{paired && <Check className="size-5 text-primary" />}</div><Button className="mt-5 h-12 w-full rounded-full" onClick={onScan}><QrCode /> {paired ? '別のAnkiとペアリング' : 'QRコードを読み取る'}</Button></div><div className="mt-6"><p className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">手動設定</p><div className="rounded-[1.125rem] border border-black/[0.08] bg-card p-5"><label className="block text-sm font-semibold" htmlFor="sync-endpoint">同期先アドレス</label><Input className="mt-2 h-11 rounded-[0.7rem] bg-background" id="sync-endpoint" inputMode="url" onChange={(event) => onChange({ ...settings, endpoint: event.target.value })} placeholder="http://192.168.1.20:8766" value={settings.endpoint} /><label className="mt-5 block text-sm font-semibold" htmlFor="sync-token">ペアリングコード</label><Input className="mt-2 h-11 rounded-[0.7rem] bg-background font-mono tracking-widest" id="sync-token" onChange={(event) => onChange({ ...settings, token: event.target.value })} placeholder="ペアリングコード" value={settings.token} /><Button className="mt-5 h-11 w-full rounded-full" onClick={onSave} variant="secondary">設定を保存</Button></div></div><div className="mt-6 flex gap-3 rounded-[1.125rem] bg-muted/70 p-4 text-xs leading-5 text-muted-foreground"><Database className="mt-0.5 size-4 shrink-0" /><p>接続情報とカードはこの端末内に保存されます。αnkiからカード本文を編集することはありません。</p></div></section>;
}

function BottomNavigation({ active, onChange }: { active: ActiveTab; onChange: (tab: ActiveTab) => void }) {
  const items: Array<{ id: ActiveTab; label: string; icon: typeof House }> = [{ id: 'home', label: 'ホーム', icon: House }, { id: 'decks', label: 'デッキ', icon: Layers3 }, { id: 'settings', label: '設定', icon: Settings2 }];
  return <nav className="apple-tabbar fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)]" aria-label="メインナビゲーション"><div className="mx-auto grid h-[4.6rem] max-w-xl grid-cols-3 px-5">{items.map((item) => { const Icon = item.icon; const selected = active === item.id; return <button aria-current={selected ? 'page' : undefined} className={`flex min-h-11 flex-col items-center justify-center gap-1 text-[0.67rem] transition-colors ${selected ? 'text-primary' : 'text-muted-foreground'}`} key={item.id} onClick={() => onChange(item.id)}><Icon className="size-[1.35rem]" strokeWidth={selected ? 2.5 : 2} /><span className={selected ? 'font-semibold' : 'font-normal'}>{item.label}</span></button>; })}</div></nav>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="grid content-center rounded-[0.7rem] px-2 text-center"><p className="text-[1.05rem] font-semibold leading-5 tracking-[-0.03em]">{value}</p><p className="text-[0.62rem] leading-4 text-muted-foreground">{label}</p></div>; }

function CardFace({ html, large = false }: { html: string; large?: boolean }) {
  const documentHtml = useMemo(() => {
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const looksLikeHtml = /<[^>]+>/.test(html);
    const content = looksLikeHtml ? html : `<div class="plain">${escapeHtml(html)}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: http: https:; media-src data: blob: http: https:; font-src data: http: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>html,body{box-sizing:border-box;width:100%;height:100%;margin:0;overflow:hidden;background:transparent;color:#1d1d1f}body{display:grid;place-items:center;padding:4px;font:400 17px/1.47 -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;text-align:center}#fit{width:100%;transform-origin:center center}.front .plain{font:600 clamp(25px,8vw,46px)/1.1 -apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;letter-spacing:-.035em}.back .plain{font-size:clamp(17px,4.8vw,25px);line-height:1.35;letter-spacing:-.015em}img{max-width:100%;max-height:calc(100vh - 12px);height:auto;object-fit:contain}audio,video,table{max-width:100%}p:first-child{margin-top:0}p:last-child{margin-bottom:0}</style></head><body><div id="fit" class="${large ? 'front' : 'back'}">${content}</div><script nonce="${nonce}">const root=document.getElementById('fit');function fit(){root.style.transform='scale(1)';const width=Math.max(root.scrollWidth,1);const height=Math.max(root.scrollHeight,1);const scale=Math.min(1,(innerWidth-8)/width,(innerHeight-8)/height);root.style.transform='scale('+scale+')'}addEventListener('load',fit);addEventListener('resize',fit);document.fonts&&document.fonts.ready.then(fit);new ResizeObserver(fit).observe(root);setTimeout(fit,60);</script></body></html>`;
  }, [html, large]);
  return <iframe className="h-full min-h-0 w-full overflow-hidden border-0 bg-transparent" referrerPolicy="no-referrer" sandbox="allow-scripts" srcDoc={documentHtml} title={large ? 'カード表面' : 'カード裏面'} />;
}

function escapeHtml(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }

function LoadingCard() { return <div className="grid min-h-0 flex-1 place-items-center rounded-[1.125rem] border border-black/[0.08] bg-card"><div className="text-center"><LoaderCircle className="mx-auto mb-3 size-7 animate-spin text-primary" /><p className="text-sm text-muted-foreground">カードを準備しています</p></div></div>; }

function EmptyReview({ paired, syncing, onSettings, onSync }: { paired: boolean; syncing: boolean; onSettings: () => void; onSync: () => void }) { return <div className="grid min-h-0 flex-1 place-items-center rounded-[1.125rem] border border-black/[0.08] bg-card p-6 text-center"><div><div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-[#fafafc] text-primary">{paired ? <Check className="size-7" /> : <RotateCcw className="size-7" />}</div><h2 className="text-2xl font-semibold tracking-[-0.035em]">{paired ? '今日の復習は完了です' : 'Ankiと接続しましょう'}</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{paired ? 'Windows Ankiと同期すると、新しい復習カードを受け取れます。' : '設定画面からQRコードを読み取ると、実際のデッキを受け取れます。'}</p><Button className="mt-6 h-11 rounded-full px-6" disabled={syncing} onClick={paired ? onSync : onSettings}>{syncing ? <LoaderCircle className="animate-spin" /> : paired ? <Download /> : <QrCode />} {paired ? '今すぐ同期' : 'ペアリングする'}</Button></div></div>; }
