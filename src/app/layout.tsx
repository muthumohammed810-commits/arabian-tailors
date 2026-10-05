import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'ARABIAN TAILORS — Elegance, Tailored for You',description:'A premium digital tailoring house. Discover custom Kanduras, refined essentials and considered Islamic lifestyle pieces.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}

