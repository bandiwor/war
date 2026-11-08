// Layer boundaries and determinism rules. Kept separate from the main config
// so tests can load them without type information (see tests/lint-rules.test.ts).

const LAYERS = ['domain', 'application', 'infrastructure', 'presentation', 'headless'];

/** Which layers each layer must NOT import. Dependencies point inward only. */
const FORBIDDEN = {
  domain: ['application', 'infrastructure', 'presentation', 'headless'],
  application: ['infrastructure', 'presentation', 'headless'],
  infrastructure: ['presentation', 'headless'],
  presentation: ['headless'],
  headless: ['infrastructure', 'presentation'],
};

/** Engine/platform packages allowed only in outer layers. */
const PLATFORM_PACKAGES = [
  'three',
  'three/*',
  '@dimforge/*',
  'recast-navigation',
  '@recast-navigation/*',
];

const NONDETERMINISTIC_PROPERTIES = [
  { object: 'Math', property: 'random', message: 'Use the seeded Rng stream from SimContext.' },
  { object: 'Date', property: 'now', message: 'Simulation time is the tick number.' },
  { object: 'performance', property: 'now', message: 'Simulation time is the tick number.' },
  ...[
    'sin',
    'cos',
    'tan',
    'asin',
    'acos',
    'atan',
    'atan2',
    'exp',
    'expm1',
    'log',
    'log2',
    'log10',
    'log1p',
    'pow',
    'cbrt',
    'sinh',
    'cosh',
    'tanh',
    'hypot',
  ].map((property) => ({
    object: 'Math',
    property,
    message: 'Math.' + property + ' is not bit-identical across engines; use domain/math/dmath.',
  })),
];

const NONDETERMINISTIC_GLOBALS = [
  'window',
  'document',
  'navigator',
  'performance',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'crypto',
  'localStorage',
  'fetch',
].map((name) => ({
  name,
  message: `"${name}" is platform/nondeterministic; inject it through a port.`,
}));

function layerFiles(layer) {
  return [`src/${layer}/**/*.ts`];
}

export const layerRules = LAYERS.map((layer) => ({
  files: layerFiles(layer),
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          ...FORBIDDEN[layer].map((target) => ({
            group: [`**/${target}/**`, `**/${target}`],
            message: `Layer "${layer}" must not depend on "${target}" (see docs/adr/0002-layered-architecture.md).`,
          })),
          ...(layer === 'domain' || layer === 'application'
            ? [
                {
                  group: PLATFORM_PACKAGES,
                  message: 'Engine/platform packages belong in infrastructure.',
                },
              ]
            : []),
        ],
      },
    ],
  },
}));

export const determinismRules = {
  files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
  ignores: ['**/*.test.ts', '**/*.bench.ts'],
  rules: {
    'no-restricted-properties': ['error', ...NONDETERMINISTIC_PROPERTIES],
    'no-restricted-globals': ['error', ...NONDETERMINISTIC_GLOBALS],
    'no-restricted-syntax': [
      'error',
      {
        selector: "NewExpression[callee.name='Date']",
        message: 'Wall-clock dates are nondeterministic.',
      },
      {
        selector: "CallExpression[callee.name='Date']",
        message: 'Wall-clock dates are nondeterministic.',
      },
    ],
  },
};
