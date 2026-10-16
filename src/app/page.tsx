'use client';

import dynamic from 'next/dynamic';

// The game touches canvas and localStorage, so it only renders in the browser.
const GoblinGame = dynamic(() => import('@/components/goblins/GoblinGame'), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center font-display text-2xl text-primary">Waking the goblins…</div>
  ),
});

export default function Home() {
  return <GoblinGame />;
}
