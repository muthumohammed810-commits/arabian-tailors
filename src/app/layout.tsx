import type { Metadata } from 'next';
import { Cormorant_Garamond, Manrope } from 'next/font/google';
import './globals.css';

const displayFont = Cormorant_Garamond({ subsets: ['latin'], weight: ['400', '500', '600'], style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });
const interfaceFont = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-ui', display: 'swap' });

export const metadata:Metadata={title:'ARABIAN TAILORS — Tailoring, Refined',description:'Precision-crafted kanduras and traditional garments, tailored to your measurements and your style.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body className={`${displayFont.variable} ${interfaceFont.variable}`}>{children}</body></html>}


