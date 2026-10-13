// Montage — données uniquement. Référence : .claude/skills/short-editing/reference/components.md
// Timings : secondes de sortie, ou calés sur la parole { say: 'phrase' }.
const FULL = [0, 0, 1080, 1920];
const BOTTOM = [0, 960, 1080, 960];

export default {
  title: '',
  format: '__FORMAT__',
  fps: 30,
  speed: 1.1,
  cuts: 'auto', // node scripts/autocut.mjs <projet>
  elements: [
    { type: 'background', dur: 'end', gradient: ['#f4f2ee', '#e9e5dc'], angle: 90, in: 'none', out: 'none' },
    { type: 'camera', dur: 'end', box: FULL, punch: 1.1, in: 'none', out: 'none' },

    // HOOK (1re seconde)
    { type: 'text', at: 0, dur: 2.5, text: 'Le **hook** ici', y: 360, size: 96, bg: 'rgba(11,11,15,0.85)', sfx: 'pop' },

    // … motion design sur tout ce qui est dit …

    { type: 'captions', dur: 'end', in: 'none', out: 'none' },
  ],
};
