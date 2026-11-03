'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react';
import { products as catalogProducts, type Product } from '@/lib/catalog';
import { productImageSource } from '@/lib/product-image-url';

type StoreProduct = Product & { images?: string[]; available?: boolean; stock?: number; stitchingType?: string; customizationSteps?: { id: string; title: string; description?: string; required?: boolean; available?: boolean; options: { id: string; name: string; description?: string; image?: string; priceAdjustment?: number; available?: boolean }[] }[] };

export default function Home() {
  const [products, setProducts] = useState<StoreProduct[]>(catalogProducts);
  const [storeSettings, setStoreSettings] = useState<Record<string, string>>({});
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/store-data', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.products)) setProducts(data.products);
        if (data.settings) {
          const settings = data.settings as Record<string, string>;
          setStoreSettings(settings);
          if (settings.gold) document.documentElement.style.setProperty('--gold', settings.gold);
          if (settings.background) document.documentElement.style.setProperty('--ink', settings.background);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const featuredKandura = products.find((product) => product.available !== false && product.category.toLowerCase() === 'kandura');
  const featuredAbaya = products.find((product) => product.available !== false && product.category.toLowerCase() === 'abaya');
  const kanduraHref = featuredKandura ? `/customize?product=${encodeURIComponent(featuredKandura.id)}` : '/customize';
  const abayaHref = featuredAbaya ? `/customize?product=${encodeURIComponent(featuredAbaya.id)}` : '/customize';
  const kanduraImage = featuredKandura ? productImageSource(featuredKandura.images?.[0] || featuredKandura.image) : '';
  const abayaImage = featuredAbaya ? productImageSource(featuredAbaya.images?.[0] || featuredAbaya.image) : '';

  return (
    <main className="storefront">
      <header className="header editorial-header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label="Arabian Tailors home">ARABIAN <span className="gold">{storeSettings.storeName?.replace(/^ARABIAN\s*/i, '') || 'TAILORS'}</span></Link>
          <nav className={`desktop-links ${mobileMenu ? 'is-open' : ''}`} aria-label="Main navigation">
            <a className="navlink" href="#collection" onClick={() => setMobileMenu(false)}>Collection</a>
            <Link className="navlink" href="/customize" onClick={() => setMobileMenu(false)}>Custom Kandura</Link>
            <a className="navlink" href="#craft" onClick={() => setMobileMenu(false)}>Our craft</a>
          </nav>
          <div className="header-actions">
            <Link className="header-appointment" href="/customize">Book a fitting <ArrowUpRight size={14}/></Link>
            <button className="mobile-menu-toggle" onClick={() => setMobileMenu((open) => !open)} aria-label={mobileMenu ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileMenu}>
              {mobileMenu ? <X size={19}/> : <Menu size={19}/>}
            </button>
          </div>
        </div>
      </header>

      <section className="hero editorial-hero">
        <div className="hero-vignette"/>
        <div className="hero-content">
          <span className="eyebrow hero-kicker">ARABIAN TAILORS · EST. IN CARE</span>
          <h1 className="serif">Tailoring,<br/><i>Refined.</i></h1>
          <p>Precision-crafted kanduras and traditional garments, tailored to your measurements and your style.</p>
          <div className="hero-actions">
            <a className="btn" href="#collection">Explore collection <ArrowRight size={15}/></a>
            <Link className="btn btn-outline" href="/customize">Design your Kandura <ArrowUpRight size={15}/></Link>
            <Link className="hero-abaya-link" href={abayaHref}>Explore the Abaya <ArrowRight size={14}/></Link>
          </div>
        </div>
        <div className="hero-garments" aria-label="Standalone Abaya and Kandura garments">
          <Link href={abayaHref} className="hero-garment hero-garment-abaya" aria-label="Explore Abaya"><span className="hero-garment-photo" role="img" aria-label="Abaya from the current collection" style={{ backgroundImage: abayaImage ? `url("${abayaImage}")` : undefined }}/></Link>
          <Link href={kanduraHref} className="hero-garment hero-garment-kandura" aria-label="Explore Kandura"><span className="hero-garment-photo" role="img" aria-label="Kandura from the current collection" style={{ backgroundImage: kanduraImage ? `url("${kanduraImage}")` : undefined }}/></Link>
        </div>
        <div className="hero-index"><span>01</span><i/> MADE TO MEASURE</div>
        <a className="hero-scroll" href="#collection">SCROLL TO DISCOVER <span/></a>
      </section>

      <section className="craft-note" id="craft">
        <p>Quiet confidence, cut to your measure.</p>
        <span>DESIGNED WITH INTENTION <i>·</i> MADE BY HAND</span>
      </section>

      <section className="section collection-section" id="collection">
        <div className="section-shell">
          <div className="collection-heading">
            <div><div className="eyebrow">The atelier edit</div><h2 className="serif">Made to <i>be yours.</i></h2></div>
            <p>Explore considered cloth, silhouettes and finishing. Each piece begins with a conversation.</p>
          </div>
          <div className="luxury-product-showcase">
            {[
              { kind: 'kandura', name: 'Kandura', product: featuredKandura, href: kanduraHref, image: kanduraImage },
              { kind: 'abaya', name: 'Abaya', product: featuredAbaya, href: abayaHref, image: abayaImage },
            ].filter((item) => item.product).map((item) => <article className={`luxury-product luxury-product-${item.kind}`} key={item.kind}>
              <Link href={item.href} className="luxury-product-image" aria-label={`Explore ${item.name}`} style={{ backgroundImage: item.image ? `url("${item.image}")` : undefined }}>
                <span className="luxury-product-shade"/>
                <span className="luxury-product-index">{item.kind === 'kandura' ? '01' : '02'} <i>—</i> ARABIAN TAILORS</span>
                <span className="luxury-product-title serif">{item.name}</span>
                <span className="luxury-product-link">Discover the piece <ArrowUpRight size={15}/></span>
              </Link>
              {item.product?.description && <p className="luxury-product-description">{item.product.description}</p>}
            </article>)}
          </div>
          <div className="collection-bottom"><span>A considered wardrobe. A personal fit.</span><Link className="text-link" href={kanduraHref}>Design your Kandura <ArrowRight size={14}/></Link></div>
        </div>
      </section>

      <section className="atelier-story">
        <div className="story-image" style={{ backgroundImage: kanduraImage ? `url("${kanduraImage}")` : undefined }}><span>THE HAND OF THE ATELIER</span></div>
        <div className="story-copy"><div className="eyebrow">The tailoring experience</div><h2 className="serif">A better fit<br/>begins with <i>you.</i></h2><p>Choose your silhouette, feel the cloth, and tell us how you like it to fit. Our tailors take it from there, with care at every stitch.</p><Link className="btn" href="/customize">Design your Kandura <ArrowRight size={15}/></Link><div className="story-signature">ARABIAN TAILORS <i>—</i> INDIA</div></div>
      </section>

      <section className="process-section"><div className="section-shell"><div className="process-heading"><div className="eyebrow">From selection to stitch</div><h2 className="serif">Crafted around your <i>style.</i></h2></div><div className="process-grid"><article><span>01</span><h3>Choose a silhouette</h3><p>Explore tailoring traditions with a modern point of view.</p></article><article><span>02</span><h3>Make it yours</h3><p>Select cloth, colour and the fit that feels right to you.</p></article><article><span>03</span><h3>Made with care</h3><p>Your design is reviewed by our tailoring team before work begins.</p></article></div></div></section>

      <footer className="footer editorial-footer"><div className="section-shell"><Link className="brand" href="/">ARABIAN <span className="gold">TAILORS</span></Link><span>© 2026 ARABIAN TAILORS <i>·</i> INDIA</span><a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>BACK TO TOP <ArrowLeft size={12}/></a></div></footer>
      <nav className="bottomnav" aria-label="Quick navigation"><a href="#collection">Discover</a><Link href="/customize">Custom</Link><a href="#craft">Our craft</a></nav>
    </main>
  );
}
