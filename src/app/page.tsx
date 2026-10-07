'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Menu, X, ChevronLeft, ChevronRight, Plus, Minus, Star } from 'lucide-react';
import { products as catalogProducts, styles as tailoringStyles, type Product } from '@/lib/catalog';
import { GarmentVisual } from '@/components/garment-visual';

type StoreProduct = Product & { images?: string[]; available?: boolean; stock?: number; stitchingType?: string; customizationSteps?: { id: string; title: string; description?: string; required?: boolean; available?: boolean; options: { id: string; name: string; description?: string; image?: string; priceAdjustment?: number; available?: boolean }[] }[] };
type Category = 'All' | 'Abaya' | 'Kandura' | 'Fabrics' | 'Stitching' | 'Custom Design';
type Card = { id: string; name: string; category: string; price: number; image: string; images?: string[]; description: string; tag?: string; href: string; rating?: number; reviews?: number; garmentKind?: 'abaya' | 'kandura' };

const categories: Category[] = ['All', 'Abaya', 'Kandura', 'Fabrics', 'Stitching', 'Custom Design'];
function toCard(product: StoreProduct): Card {
  const category = product.category.toLowerCase();
  return {
    id: product.id, name: product.name, category: product.category, price: product.price,
    image: product.images?.[0] || product.image, images: product.images?.length ? product.images : [product.image], description: product.description, tag: product.tag,
    href: category === 'kandura' || category === 'abaya' || product.customizationSteps?.length ? `/customize?product=${encodeURIComponent(product.id)}` : '#collection',
    garmentKind: category === 'abaya' ? 'abaya' : category === 'kandura' ? 'kandura' : undefined,
    rating: product.rating, reviews: product.reviews,
  };
}

export default function Home() {
  const [products, setProducts] = useState<StoreProduct[]>(catalogProducts);
  const [storeSettings, setStoreSettings] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<Category>('All');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);

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

  const cards = useMemo<Card[]>(() => {
    const inStock = (product: StoreProduct) => product.available !== false;
    if (category === 'Abaya') return products.filter((product) => inStock(product) && product.category.toLowerCase() === 'abaya').map(toCard);
    if (category === 'Kandura') return products.filter((product) => inStock(product) && product.category.toLowerCase() === 'kandura').map(toCard);
    if (category === 'Fabrics') return products.filter((product) => inStock(product) && product.category.toLowerCase() === 'fabric').map(toCard);
    if (category === 'Stitching') {
      const serviceProducts = products.filter((product) => inStock(product) && product.category.toLowerCase() === 'kandura');
      if (serviceProducts.length) return serviceProducts.map((product) => ({
        ...toCard(product), category: 'Stitching', garmentKind: 'kandura',
        name: product.stitchingType ? `${product.stitchingType} tailoring` : product.name,
      }));
      return tailoringStyles.map((style) => ({
        id: `stitching-${style.id}`, name: `${style.name} tailoring`, category: 'Stitching', price: style.price,
        image: '', description: style.desc, href: '/customize', garmentKind: 'kandura',
      }));
    }
    if (category === 'Custom Design') return [];
    return products.map(toCard);
  }, [category, products]);
  const featuredAbaya = products.find((product) => product.available !== false && product.category.toLowerCase() === 'abaya') || catalogProducts.find((product) => product.category.toLowerCase() === 'abaya');
  const abayaHref = featuredAbaya ? `/customize?product=${encodeURIComponent(featuredAbaya.id)}` : '/customize';

  function moveCarousel(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(rail.clientWidth * 0.78, 280), behavior: 'smooth' });
  }

  function updateActiveSlide() {
    const rail = railRef.current;
    const firstCard = rail?.firstElementChild as HTMLElement | null;
    if (!rail || !firstCard) { setActiveSlide(0); return; }
    const gap = Number.parseFloat(getComputedStyle(rail).columnGap || '0');
    setActiveSlide(Math.round(rail.scrollLeft / (firstCard.offsetWidth + gap)));
  }

  useEffect(() => {
    if (railRef.current) railRef.current.scrollTo({ left: 0 });
    setActiveSlide(0);
    setExpandedCard(null);
  }, [category]);

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
          <Link href={abayaHref} className="hero-garment hero-garment-abaya" aria-label={`Explore ${featuredAbaya?.name || 'the Abaya'}`}><GarmentVisual kind="abaya" /></Link>
          <Link href="/customize" className="hero-garment hero-garment-kandura" aria-label="Design a Kandura"><GarmentVisual kind="kandura" /></Link>
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
          <div className="category-strip" role="tablist" aria-label="Shop categories">
            {categories.map((item) => <button key={item} role="tab" aria-selected={category === item} className={`category-tab ${category === item ? 'active' : ''}`} onClick={() => setCategory(item)}>{item}<span/></button>)}
          </div>

          {category === 'Custom Design' ? (
            <div className="custom-design-feature">
              <div className="custom-feature-image"><GarmentVisual kind="abaya" /></div>
              <div className="custom-feature-copy"><span className="eyebrow">A garment, your way</span><h3 className="serif">Begin with a blank canvas.</h3><p>Choose your silhouette, cloth, colour and fit in a guided, step-by-step experience.</p><Link className="text-link" href="/customize">Start your design <ArrowRight size={15}/></Link></div>
            </div>
          ) : (
            <>
              <div className="carousel-tools"><span className="carousel-caption">{String(activeSlide + 1).padStart(2, '0')} <i>/</i> {String(cards.length).padStart(2, '0')} PIECES</span><div><button onClick={() => moveCarousel(-1)} aria-label="Previous pieces"><ChevronLeft size={17}/></button><button onClick={() => moveCarousel(1)} aria-label="Next pieces"><ChevronRight size={17}/></button></div></div>
              <div className="product-rail" ref={railRef} onScroll={updateActiveSlide}>
                {cards.map((card) => <article className={`product-card editorial-card ${expandedCard === card.id ? 'expanded' : ''}`} key={card.id}>
                  <Link href={card.href} className="product-visual" aria-label={`View ${card.name}`}>
                    {card.garmentKind ? <GarmentVisual kind={card.garmentKind} className="product-garment-visual" /> : card.category.toLowerCase() === 'fabric' ? <div className="product-img fabric-visual" aria-hidden="true" /> : <div className="product-img" style={{ backgroundImage: `url('${card.image}')` }} />}
                    {card.tag && <span className="tag">{card.tag}</span>}
                    {products.find((product) => product.id === card.id)?.available === false && <span className="availability-tag">Unavailable</span>}
                    <span className="product-visual-mark"><ArrowUpRight size={16}/></span>
                  </Link>
                  <div className="product-info">
                    <div className="product-meta"><span>{card.category}</span>{card.rating && <span><Star size={11} fill="var(--gold)"/> {card.rating} <i>({card.reviews})</i></span>}</div>
                    <Link href={card.href}><h3>{card.name}</h3></Link>
                    <div className="product-price-row"><span className="price">₹{card.price.toLocaleString('en-IN')}</span><span className="made-note">{products.find((product) => product.id === card.id)?.available === false ? 'CURRENTLY UNAVAILABLE' : 'MADE TO ORDER'}</span></div>
                    <button className="card-expand" aria-expanded={expandedCard === card.id} onClick={() => setExpandedCard(expandedCard === card.id ? null : card.id)}>{expandedCard === card.id ? 'Less detail' : 'Discover details'}{expandedCard === card.id ? <Minus size={13}/> : <Plus size={13}/>}</button>
                    {expandedCard === card.id && <div className="card-detail"><p>{card.description}</p><Link href={card.href}>Explore this piece <ArrowRight size={13}/></Link></div>}
                  </div>
                </article>)}
                {!cards.length && <div className="empty-collection">No pieces in this edit yet. <Link href="/customize">Create a custom design <ArrowRight size={14}/></Link></div>}
              </div>
              {cards.length > 1 && <div className="carousel-dots" aria-label="Carousel position">{cards.map((card, index) => <button key={card.id} className={index === activeSlide ? 'active' : ''} onClick={() => railRef.current?.children[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })} aria-label={`Show piece ${index + 1}`}/>)}</div>}
            </>
          )}
          <div className="collection-bottom"><span>A considered wardrobe. A personal fit.</span><Link className="text-link" href="/customize">Visit the configurator <ArrowRight size={14}/></Link></div>
        </div>
      </section>

      <section className="atelier-story">
        <div className="story-image"><GarmentVisual kind="kandura" className="story-garment-visual" /><span>THE HAND OF THE ATELIER</span></div>
        <div className="story-copy"><div className="eyebrow">The tailoring experience</div><h2 className="serif">A better fit<br/>begins with <i>you.</i></h2><p>Choose your silhouette, feel the cloth, and tell us how you like it to fit. Our tailors take it from there, with care at every stitch.</p><Link className="btn" href="/customize">Design your Kandura <ArrowRight size={15}/></Link><div className="story-signature">ARABIAN TAILORS <i>—</i> INDIA</div></div>
      </section>

      <section className="process-section"><div className="section-shell"><div className="process-heading"><div className="eyebrow">From selection to stitch</div><h2 className="serif">Crafted around your <i>style.</i></h2></div><div className="process-grid"><article><span>01</span><h3>Choose a silhouette</h3><p>Explore tailoring traditions with a modern point of view.</p></article><article><span>02</span><h3>Make it yours</h3><p>Select cloth, colour and the fit that feels right to you.</p></article><article><span>03</span><h3>Made with care</h3><p>Your design is reviewed by our tailoring team before work begins.</p></article></div></div></section>

      <footer className="footer editorial-footer"><div className="section-shell"><Link className="brand" href="/">ARABIAN <span className="gold">TAILORS</span></Link><span>© 2026 ARABIAN TAILORS <i>·</i> INDIA</span><a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>BACK TO TOP <ArrowLeft size={12}/></a></div></footer>
      <nav className="bottomnav" aria-label="Quick navigation"><a href="#collection">Discover</a><Link href="/customize">Custom</Link><a href="#craft">Our craft</a></nav>
    </main>
  );
}
