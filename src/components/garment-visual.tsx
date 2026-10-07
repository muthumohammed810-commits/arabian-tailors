type GarmentKind = 'abaya' | 'kandura';

export function GarmentVisual({ kind, className = '' }: { kind: GarmentKind; className?: string }) {
  const isAbaya = kind === 'abaya';
  const id = isAbaya ? 'abaya' : 'kandura';

  return (
    <div className={`garment-art garment-art-${id} ${className}`} aria-hidden="true">
      <span className="garment-halo" />
      <svg viewBox="0 0 400 520" role="presentation" focusable="false">
        <defs>
          <linearGradient id={`${id}-cloth`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={isAbaya ? '#27262a' : '#f3eee2'} />
            <stop offset="0.48" stopColor={isAbaya ? '#121216' : '#d9d3c8'} />
            <stop offset="1" stopColor={isAbaya ? '#343239' : '#fbf8f0'} />
          </linearGradient>
          <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#8c7045" stopOpacity=".2" />
            <stop offset=".5" stopColor="#d3b879" stopOpacity=".9" />
            <stop offset="1" stopColor="#8c7045" stopOpacity=".2" />
          </linearGradient>
          <filter id={`${id}-shadow`} x="-40%" y="-30%" width="180%" height="180%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="12" />
            <feOffset dy="14" />
            <feComponentTransfer><feFuncA type="linear" slope=".32" /></feComponentTransfer>
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g className="garment-shape" filter={`url(#${id}-shadow)`}>
          {isAbaya ? (
            <>
              <path d="M151 83 115 103 65 191l45 24 29-46-14 220q75 33 150 0l-14-220 29 46 45-24-50-88-36-20-49-11z" fill={`url(#${id}-cloth)`} stroke="#81714f" strokeOpacity=".62" strokeWidth="1.5" />
              <path d="m151 83 49 18 49-18-17 54-32 17-32-17z" fill="#1d1b20" stroke="#9f8456" strokeOpacity=".8" />
              <path d="M200 155v229" stroke={`url(#${id}-edge)`} strokeWidth="2" />
              <path d="M128 218q-15 72-7 146M272 218q15 72 7 146" fill="none" stroke="#b59b69" strokeOpacity=".22" strokeWidth="2" />
              <path d="M139 396q61 22 122 0" fill="none" stroke="#c9a96e" strokeOpacity=".62" strokeWidth="2" />
              <path d="M165 102q35 16 70 0" fill="none" stroke="#c9a96e" strokeOpacity=".6" strokeWidth="1.5" />
            </>
          ) : (
            <>
              <path d="M153 78 119 93 69 177l44 25 29-44-12 223q70 24 140 0l-12-223 29 44 44-25-50-84-34-15-47-9z" fill={`url(#${id}-cloth)`} stroke="#a4977d" strokeOpacity=".7" strokeWidth="1.5" />
              <path d="m153 78 47 15 47-15-12 34-35 15-35-15z" fill="#d8d0c1" stroke="#9c8d72" strokeWidth="1.2" />
              <path d="M200 126v241" stroke="#9e8a62" strokeOpacity=".7" strokeWidth="1.5" />
              {[155, 178, 201, 224, 247].map((y) => <circle key={y} cx="200" cy={y} r="2.4" fill="#b59a64" />)}
              <path d="M220 204h27v42h-27z" fill="none" stroke="#a18a5e" strokeOpacity=".55" strokeWidth="1.2" />
              <path d="M135 390q65 21 130 0" fill="none" stroke="#a18a5e" strokeOpacity=".55" strokeWidth="1.4" />
            </>
          )}
        </g>
      </svg>
      <span className="garment-art-caption">{isAbaya ? 'NOOR · FLUID SILHOUETTE' : 'SIGNATURE · PURE COTTON'}</span>
    </div>
  );
}
