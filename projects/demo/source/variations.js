// Variations de style des sous-titres — rendues côte à côte au même instant :
//   node engine/render.mjs demo --variations source/variations.js --at 9
// Choisis-en une, puis demande à l'agent de l'appliquer dans le skill (style.json).
export default [
  { name: 'Défaut', theme: {} },
  { name: 'Jaune pop', theme: { captions: { highlight: '#ffd400', uppercase: true, size: 84 } } },
  { name: 'Fond bleu', theme: { captions: { highlightBg: '#2f7bff', highlight: '#fff', stroke: false, size: 80 } } },
  { name: 'Minimal', theme: { captions: { stroke: false, pop: false, weight: 700, size: 64, color: '#fff', highlight: '#fff', dimUnspoken: true } } },
  { name: 'Gros mot unique', theme: { captions: { maxWords: 1, size: 120, uppercase: true, highlight: '#ff3b30' } } },
  { name: 'Bas + vert', theme: { captions: { y: '88%', highlight: '#22c55e', size: 70 } } },
];
