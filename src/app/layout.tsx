import type { Metadata } from 'next';
import './globals.css';

export const metadata:Metadata={title:'ARABIAN TAILORS — Tailoring, Refined',description:'Precision-crafted kanduras and traditional garments, tailored to your measurements and your style.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}


