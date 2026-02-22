export function AbstractBg() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {/* Gradient blobs */}
      <div className="absolute -top-[25%] -left-[10%] h-[600px] w-[600px] rounded-full bg-primary/[0.07] blur-[120px]" />
      <div className="absolute top-[10%] right-[-5%] h-[500px] w-[500px] rounded-full bg-primary/[0.05] blur-[100px]" />
      <div className="absolute bottom-[-10%] left-[20%] h-[450px] w-[450px] rounded-full bg-primary/[0.04] blur-[100px]" />

      {/* Grid */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.04]">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Abstract geometric shapes */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.06]"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        {/* Flowing curves */}
        <path
          d="M-100 600C100 500 300 700 500 550S800 300 1000 450S1300 700 1540 500"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          opacity="0.6"
        />
        <path
          d="M-50 700C150 580 350 780 550 630S850 380 1050 530S1350 780 1540 600"
          stroke="hsl(var(--primary))"
          strokeWidth="1"
          opacity="0.4"
        />
        <path
          d="M-100 200C200 350 400 150 600 300S900 500 1100 350S1400 100 1540 250"
          stroke="hsl(var(--primary))"
          strokeWidth="1.5"
          opacity="0.5"
        />
        <path
          d="M-50 100C250 250 450 50 650 200S950 400 1150 250S1450 50 1540 150"
          stroke="hsl(var(--primary))"
          strokeWidth="1"
          opacity="0.3"
        />

        {/* Circles */}
        <circle cx="200" cy="150" r="80" stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.4" />
        <circle cx="200" cy="150" r="120" stroke="hsl(var(--primary))" strokeWidth="0.5" opacity="0.2" />
        <circle cx="1200" cy="700" r="100" stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.35" />
        <circle cx="1200" cy="700" r="160" stroke="hsl(var(--primary))" strokeWidth="0.5" opacity="0.15" />
        <circle cx="700" cy="450" r="60" stroke="hsl(var(--primary))" strokeWidth="0.6" opacity="0.25" />

        {/* Diamond / rotated squares */}
        <rect
          x="900" y="100" width="80" height="80"
          stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.3"
          transform="rotate(45 940 140)"
        />
        <rect
          x="350" y="650" width="60" height="60"
          stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.25"
          transform="rotate(45 380 680)"
        />

        {/* Dots cluster */}
        {[
          [1050, 200], [1070, 220], [1090, 200], [1070, 180],
          [1050, 240], [1090, 240], [1110, 220], [1030, 220],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="2" fill="hsl(var(--primary))" opacity="0.4" />
        ))}
        {[
          [300, 400], [320, 420], [340, 400], [320, 380],
          [300, 440], [340, 440], [360, 420], [280, 420],
        ].map(([cx, cy], i) => (
          <circle key={`b${i}`} cx={cx} cy={cy} r="2" fill="hsl(var(--primary))" opacity="0.3" />
        ))}

        {/* Triangles */}
        <polygon
          points="600,80 640,150 560,150"
          stroke="hsl(var(--primary))" strokeWidth="0.8" fill="none" opacity="0.3"
        />
        <polygon
          points="1300,500 1340,570 1260,570"
          stroke="hsl(var(--primary))" strokeWidth="0.8" fill="none" opacity="0.25"
        />

        {/* Cross / plus marks */}
        <g stroke="hsl(var(--primary))" strokeWidth="1" opacity="0.3">
          <line x1="130" y1="500" x2="130" y2="520" />
          <line x1="120" y1="510" x2="140" y2="510" />
        </g>
        <g stroke="hsl(var(--primary))" strokeWidth="1" opacity="0.25">
          <line x1="1350" y1="300" x2="1350" y2="320" />
          <line x1="1340" y1="310" x2="1360" y2="310" />
        </g>
        <g stroke="hsl(var(--primary))" strokeWidth="1" opacity="0.2">
          <line x1="800" y1="750" x2="800" y2="770" />
          <line x1="790" y1="760" x2="810" y2="760" />
        </g>
      </svg>
    </div>
  );
}
