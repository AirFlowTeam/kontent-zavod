import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kontent-zavod-2026.mikhailzhees.chatgpt.site'),
  title: 'Контент-завод — учёт креаторов и охватов',
  description: 'Внутренний сервис для учёта публикаций, креаторов и охватов.',
  openGraph: {
    title: 'Контент-завод',
    description: 'Креаторы · ролики · охваты',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Контент-завод — креаторы, ролики и охваты' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Контент-завод',
    description: 'Креаторы · ролики · охваты',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
