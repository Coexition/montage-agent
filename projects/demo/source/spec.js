// Montage du short "moteur vs remotion".
// Tout est des DONNÉES : le moteur (engine/) fait le reste.
// Les timings peuvent être en secondes (sortie) ou calés sur la parole : { say: "cent six secondes" }.

const CAM_FULL = [0, 0, 1080, 1920];
const CAM_BOTTOM = [0, 960, 1080, 960];

export default {
  title: 'Mon moteur vs Remotion vs HyperFrames',
  format: '9:16',
  fps: 30,
  speed: 1.1,          // accélération globale (rétention)
  cuts: 'auto',        // source/cuts.json (scripts/autocut.mjs)
  music: null,
  elements: [
    { type: 'background', dur: 'end', gradient: ['#f4f2ee', '#e9e5dc'], angle: 90, in: 'none', out: 'none' },

    // caméra plein écran au début, puis en bas pendant les explications
    { type: 'camera', at: 0, end: { say: 'benchmarké', offset: -0.1 }, box: CAM_FULL, punch: 1.1, in: 'none', out: 'none',
      zooms: [{ at: { say: 'IA' }, scale: 1.2, dur: 0.25, hold: 0.6 }] },
    { type: 'camera', at: { say: 'benchmarké', offset: -0.1 }, dur: 'end', box: CAM_BOTTOM, focus: [0.5, 0.3], punch: 1.08, in: 'up', out: 'none' },

    // HOOK
    { type: 'text', at: 0, end: { say: 'benchmarké', offset: -0.1 }, text: 'Remotion & HyperFrames : **mauvaise idée** ?', y: 360, size: 92, bg: 'rgba(11,11,15,0.85)', in: 'pop', sfx: 'pop' },

    // transition : pas de trou visuel pendant "J'ai benchmarké les trois"
    { type: 'text', at: { say: 'benchmarké' }, end: { say: 'Remotion a pris' }, text: "J'ai benchmarké **les 3**", y: 420, size: 110, color: '#0b0b0f', shadow: false, in: 'words', sfx: 'whoosh' },

    // benchmark
    { type: 'badge', at: { say: 'Remotion a pris' }, end: { say: 'HyperFrames cinquante' }, text: 'Remotion', logo: 'assets/remotion.svg', y: 150, in: 'down', sfx: 'whoosh' },
    { type: 'counter', at: { say: 'cent six' }, end: { say: 'HyperFrames cinquante' }, from: 0, to: 106.3, decimals: 1, suffix: 's', y: 330, size: 210, color: '#0b0b0f', in: 'pop' },
    { type: 'progress', at: { say: 'presque aussi long' }, end: { say: 'HyperFrames cinquante' }, box: [120, 640, 840, 34], frames: 1600, time: 106, color: '#2f7bff', textColor: '#0b0b0f', in: 'fade' },
    { type: 'stamp', at: { say: 'aussi long que la vidéo' }, end: { say: 'HyperFrames cinquante' }, text: 'TROP LENT', y: 810, size: 90, sfx: 'pop' },

    { type: 'bars', at: { say: 'HyperFrames cinquante' }, end: { say: 'Juste Chrome' }, box: [80, 140, 920, 620], unit: 's', max: 110, highlight: 2,
      items: [
        { label: 'Remotion', value: 106.3, logo: 'assets/remotion.svg', color: '#9aa3b2' },
        { label: 'HyperFrames', value: 53.6, logo: 'assets/hyperframes.svg', color: '#9aa3b2' },
        { label: 'Mon moteur', value: 8.5, logo: 'assets/chrome.svg', color: '#2f7bff' },
      ], labelColor: '#0b0b0f', in: 'fade', sfx: 'whoosh' },
    { type: 'circle', at: { say: 'huit virgule cinq', offset: 0.3 }, end: { say: 'Juste Chrome' }, x: 300, y: 690, w: 380, h: 170, color: '#ff3b30', in: 'none' },

    { type: 'list', at: { say: 'Juste Chrome' }, end: { say: 'douze fois' }, x: 110, y: 230, size: 68, color: '#0b0b0f',
      items: ['Juste **Chrome**', 'Un **canvas**', '**WebCodecs** H.264'],
      times: [{ say: 'Chrome' }, { say: 'canvas' }, { say: 'WebCodecs' }], in: 'none' },

    { type: 'text', at: { say: 'douze fois' }, end: { say: 'Lien' }, text: '**12×** plus rapide', y: 420, size: 150, color: '#0b0b0f', shadow: false, in: 'zoom', sfx: 'pop' },
    { type: 'shake', at: { say: 'douze fois' }, dur: 0.35, amount: 22 },
    { type: 'flash', at: { say: 'douze fois' }, dur: 0.25, opacity: 0.7 },
    { type: 'emoji', at: { say: 'douze fois', offset: 0.4 }, end: { say: 'Lien' }, char: '🚀', x: 860, y: 230, size: 160, in: 'spin' },

    { type: 'arrow', at: { say: 'Lien' }, dur: 'end', from: [300, 500], to: [760, 860], curve: 0.35, color: '#2f7bff', in: 'none' },
    { type: 'text', at: { say: 'Lien' }, dur: 'end', text: 'Lien en commentaire 👇', y: 380, size: 84, color: '#0b0b0f', shadow: false, in: 'up' },

    // sous-titres karaoké toujours au-dessus
    { type: 'captions', at: 0, dur: 'end', y: '80%', in: 'none', out: 'none' },
  ],
};
