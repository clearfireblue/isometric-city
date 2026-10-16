import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/nunito';
import './globals.css';

export const metadata: Metadata = {
  title: 'Goblin Hollow — a cozy goblin village',
  description: 'Build a hillside home for a little community of goblins and watch them live, eat, chat and dream.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#1c1510',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased overflow-hidden">{children}</body>
    </html>
  );
}
