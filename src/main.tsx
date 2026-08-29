import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReviewerApp } from '@/components/reviewer-app';
import '@/app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('αnkiの起動先を見つけられませんでした。');

createRoot(root).render(
  <StrictMode>
    <ReviewerApp />
  </StrictMode>,
);
