// The animated brain on the Neural Net page: a glowing outline whose neurons
// fire in turn while signals run along the links between them, inside a
// slowly turning scan ring. It speeds up while the engine is training or
// deciding (`busy`), so the motion also says something.

// Neuron positions inside the outline (viewBox 0 0 200 150).
const N: Array<[number, number]> = [
  [52, 62], [70, 44], [92, 34], [116, 32], [140, 40], [158, 58],
  [60, 86], [82, 66], [104, 56], [128, 60], [148, 80], [72, 104],
  [96, 88], [120, 84], [140, 102], [100, 112], [118, 108], [84, 120],
]
// Links between nearby neurons.
const L: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 6], [1, 7], [2, 8], [3, 8], [4, 9], [5, 10],
  [6, 7], [7, 8], [8, 9], [9, 10], [6, 11], [7, 12], [8, 12], [9, 13], [10, 14], [11, 12],
  [12, 13], [13, 14], [12, 15], [13, 16], [15, 16], [11, 17], [15, 17], [14, 16],
]

const OUTLINE =
  'M44 78C30 72 30 52 44 46C44 30 62 20 76 24C84 12 104 10 116 18C130 10 152 16 158 30C176 32 186 50 178 64' +
  'C190 76 184 98 168 102C166 118 148 126 134 120C124 132 102 134 92 124C78 132 58 126 56 112C40 112 30 96 44 78Z'
const FOLDS = [
  'M76 24C72 36 80 44 90 42',
  'M116 18C110 30 118 38 130 34',
  'M158 30C148 38 150 50 162 52',
  'M44 46C54 50 58 60 52 68',
  'M178 64C166 64 160 74 166 84',
  'M92 124C92 112 102 106 112 110',
  'M56 112C66 106 66 96 60 90',
  'M134 120C130 110 138 100 148 102',
  'M100 58C96 72 108 80 118 74',
]

export function Brain({ busy = false, size = 180 }: { busy?: boolean; size?: number }) {
  return (
    <svg
      className={'nn-brain' + (busy ? ' busy' : '')}
      width={size}
      height={size * 0.78}
      viewBox="0 0 200 156"
      role="img"
      aria-label="Self-learning model"
    >
      <defs>
        <radialGradient id="nnbGlow" cx="50%" cy="48%" r="55%">
          <stop offset="0" stopColor="#6f5bff" stopOpacity=".55" />
          <stop offset=".6" stopColor="#2b6fff" stopOpacity=".16" />
          <stop offset="1" stopColor="#2b6fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="nnbLine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5ee7ff" />
          <stop offset=".5" stopColor="#7c8cff" />
          <stop offset="1" stopColor="#d06bff" />
        </linearGradient>
        <filter id="nnbBlur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <ellipse cx="108" cy="74" rx="96" ry="72" fill="url(#nnbGlow)" className="nn-brain-glow" />
      <g className="nn-brain-ring">
        <circle cx="108" cy="74" r="70" fill="none" stroke="#5ee7ff" strokeOpacity=".35" strokeWidth="1" strokeDasharray="3 7" />
        <path d="M108 4a70 70 0 0 1 60 34" fill="none" stroke="#5ee7ff" strokeWidth="2" strokeLinecap="round" />
        <path d="M48 110a70 70 0 0 1-8-24" fill="none" stroke="#d06bff" strokeWidth="2" strokeLinecap="round" />
      </g>
      <path d={OUTLINE} fill="rgba(60,80,255,.08)" stroke="url(#nnbLine)" strokeWidth="6" opacity=".35" filter="url(#nnbBlur)" />
      <path d={OUTLINE} fill="none" stroke="url(#nnbLine)" strokeWidth="1.8" />
      {FOLDS.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="url(#nnbLine)" strokeWidth="1.2" strokeOpacity=".55" strokeLinecap="round" />
      ))}
      <path d="M112 128c2 10 0 18-6 24" fill="none" stroke="url(#nnbLine)" strokeWidth="2.4" strokeLinecap="round" opacity=".8" />
      <g className="nn-brain-links">
        {L.map(([a, b], i) => (
          <line
            key={i}
            x1={N[a][0]}
            y1={N[a][1]}
            x2={N[b][0]}
            y2={N[b][1]}
            style={{ animationDelay: `${(i * 0.37) % 3}s` }}
          />
        ))}
      </g>
      <g className="nn-brain-nodes">
        {N.map(([x, y], i) => (
          <g key={i} style={{ animationDelay: `${(i * 0.53) % 2.6}s` }}>
            <circle cx={x} cy={y} r="5" className="halo" />
            <circle cx={x} cy={y} r="2.2" className="core" />
          </g>
        ))}
      </g>
    </svg>
  )
}
