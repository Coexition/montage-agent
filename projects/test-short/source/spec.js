// Short test — "Billy te présente sa bande" (scène 3:50 → 4:56 du rush gameplay).
// Rush 16:9 sans face-cam : gameplay en bande centrale (cover), cartes en haut sur fond crème, sous-titres en bas.
// Le zoom 1.22 + focus haut masque les sous-titres incrustés du jeu.
const INK = '#0b0b0f';
const CAM = { type: 'camera', box: [0, 520, 1080, 1020], zoom: 1.22, focus: [0.5, 0.2], radius: 0, in: 'none', out: 'none' };
const NAME = { type: 'text', y: 210, size: 150, color: INK, shadow: false, in: 'pop', sfx: 'pop' };
const DESC = { type: 'text', y: 400, size: 60, weight: 700, color: INK, shadow: false, in: 'up' };

export default {
  title: 'Billy te présente sa bande',
  format: '9:16',
  fps: 30,
  speed: 1.1,
  cuts: 'auto', // source/cuts.json : 229.9 → 296.1 s du rush, 2 blancs retirés
  elements: [
    { type: 'background', dur: 'end', gradient: ['#f4f2ee', '#e9e5dc'], angle: 90, in: 'none', out: 'none' },
    { ...CAM, dur: 'end',
      zooms: [
        { at: { say: 'Rehab' }, scale: 1.25, dur: 0.2, hold: 0.8 },
        { at: { say: 'every five minutes' }, scale: 1.2, dur: 0.25, hold: 1.2 },
        { at: { say: 'I never eat' }, scale: 1.25, dur: 0.2, hold: 1 },
        { at: { say: 'even a' }, scale: 1.3, dur: 0.2, hold: 1.5 },
      ] },

    // HOOK (0 s)
    { type: 'text', at: 0, end: { say: 'Gonna run' }, text: 'Billy te présente **sa** **bande** 🤘', y: 260, size: 96, bg: 'rgba(11,11,15,0.88)', in: 'pop', sfx: 'whoosh' },
    { type: 'counter', at: { say: 'Gonna run' }, end: { say: 'my boy' }, from: 0, to: 5, suffix: ' potes', suffixColor: '#2f7bff', y: 200, size: 190, color: INK, countDur: 0.8, sfx: 'pop' },
    { type: 'text', at: { say: 'before they pop' }, end: { say: 'my boy' }, text: '…et **5** **cas** **sociaux**', ...{ y: 400, size: 64, weight: 800, color: INK, shadow: false }, in: 'up' },

    // RICKY
    { ...NAME, at: { say: 'my boy' }, end: { say: 'This is Sam' }, text: '**RICKY**' },
    { ...DESC, at: { say: 'brother since' }, end: { say: 'This is Sam' }, text: 'Son frère depuis le CM2 🤝' },
    { type: 'emoji', at: { say: 'Fifth grade' }, end: { say: 'This is Sam' }, char: '🏀', x: 930, y: 110, size: 120, in: 'spin' },

    // SAM
    { ...NAME, at: { say: 'This is Sam' }, end: { say: 'Ian' }, text: '**SAM**' },
    { ...DESC, at: { say: 'basically a vet' }, end: { say: 'Ian' }, text: 'Quasi une vétérane 🎖️' },
    { type: 'stamp', at: { say: 'Finally' }, end: { say: 'Ian' }, text: 'ENFIN !', x: 820, y: 640, size: 80, angle: -10, sfx: 'pop' },

    // IAN
    { ...NAME, at: { say: 'Ian' }, end: { say: 'This is Brittany' }, text: '**IAN**' },
    { ...DESC, at: { say: 'scared of' }, end: { say: 'Rehab' }, text: "N'a peur de rien… sauf du **savon** 🧼" },
    { type: 'stamp', at: { say: 'Rehab' }, end: { say: 'This is Brittany' }, text: 'REHAB', y: 420, size: 110, angle: -6 },
    { type: 'shake', at: { say: 'Rehab' }, dur: 0.3, amount: 18 },

    // BRITTANY
    { ...NAME, at: { say: 'This is Brittany' }, end: { say: 'And EJ' }, text: '**BRITTANY**' },
    { ...DESC, at: { say: 'new' }, end: { say: 'And EJ' }, text: 'La petite nouvelle 💖' },
    { type: 'emoji', at: { say: 'love you too' }, end: { say: 'And EJ' }, char: '🥰', x: 930, y: 110, size: 120, in: 'zoom' },

    // EJ
    { ...NAME, at: { say: 'And EJ' }, end: { say: 'every five minutes' }, text: '**EJ**' },
    { ...DESC, at: { say: 'Fully suck' }, end: { say: 'every five minutes' }, text: 'Le pilote… approximatif 😬' },
    { type: 'text', at: { say: 'every five minutes' }, end: { say: 'Nice to meet' }, text: '1 chute toutes les', y: 110, size: 58, weight: 700, color: INK, shadow: false, in: 'fade' },
    { type: 'counter', at: { say: 'every five minutes' }, end: { say: 'Nice to meet' }, from: 0, to: 5, suffix: ' min', suffixColor: '#ff3b30', y: 290, size: 200, color: INK, countDur: 0.6 },
    { type: 'emoji', at: { say: 'hilarious' }, end: { say: 'Nice to meet' }, char: '💥', x: 900, y: 290, size: 140, in: 'spin', sfx: 'pop' },

    // récap de la bande : 5 cartes perso qui arrivent une à une, check vert, bandeau "BANDE VALIDÉE"
    { type: 'custom', at: { say: 'Nice to meet' }, end: { say: 'next bike race' }, in: 'none', out: 'fade', sfx: 'whoosh',
      crew: [
        { n: 'Ricky', r: 'le frère', c: '#2f7bff' },
        { n: 'Sam', r: 'vétérane', c: '#8b5cf6' },
        { n: 'Ian', r: 'rehab', c: '#f97316' },
        { n: 'Brittany', r: 'la nouvelle', c: '#ec4899' },
        { n: 'EJ', r: 'crash test', c: '#ef4444' },
      ],
      draw(ctx, s) {
        const { E, clamp, spring, roundRect } = s.helpers;
        const W = 184, H = 262, GAP = 14, X0 = (1080 - (5 * W + 4 * GAP)) / 2, Y0 = 168;
        this.crew.forEach((m, i) => {
          const t = s.local - 0.1 - i * 0.13;
          if (t <= 0) return;
          const k = spring(t, { stiffness: 220, damping: 15 });
          const x = X0 + i * (W + GAP), y = Y0 + (1 - k) * 60;
          ctx.save();
          ctx.globalAlpha = clamp(t / 0.15);
          ctx.translate(x + W / 2, y + H / 2); ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k); ctx.translate(-W / 2, -H / 2);
          // carte
          ctx.shadowColor = 'rgba(0,0,0,0.14)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
          ctx.fillStyle = '#ffffff'; roundRect(ctx, 0, 0, W, H, 30); ctx.fill();
          ctx.shadowColor = 'transparent';
          // bandeau couleur + pastille initiale
          ctx.save(); roundRect(ctx, 0, 0, W, H, 30); ctx.clip();
          ctx.fillStyle = m.c; ctx.globalAlpha *= 0.14; ctx.fillRect(0, 0, W, 92); ctx.restore();
          ctx.fillStyle = m.c; ctx.beginPath(); ctx.arc(W / 2, 92, 54, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = s.font(900, m.n.length > 2 ? 58 : 50); ctx.fillText(m.n === 'EJ' ? 'EJ' : m.n[0], W / 2, 95);
          // nom + rôle
          ctx.fillStyle = '#0b0b0f'; ctx.font = s.font(900, m.n.length > 6 ? 30 : 36); ctx.fillText(m.n, W / 2, 186);
          ctx.fillStyle = '#7a7a80'; ctx.font = s.font(600, 22, s.theme.fonts.body); ctx.fillText(m.r.toUpperCase(), W / 2, 224);
          // check vert qui pop
          const c = spring(t - 0.25, { stiffness: 300, damping: 12 });
          if (c > 0) {
            ctx.save(); ctx.translate(W - 26, 26); ctx.scale(c, c);
            ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(-10, 1); ctx.lineTo(-3, 8); ctx.lineTo(11, -8); ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        });
        // bandeau "BANDE VALIDÉE" après la dernière carte
        const b = spring(s.local - 0.95, { stiffness: 260, damping: 13 });
        if (b > 0) {
          ctx.save(); ctx.translate(540, 92); ctx.rotate(-0.03); ctx.scale(b, b);
          ctx.font = s.font(900, 50); const tw = ctx.measureText('BANDE VALIDÉE').width;
          const w = tw + 130, h = 84;
          ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
          ctx.fillStyle = '#0b0b0f'; roundRect(ctx, -w / 2, -h / 2, w, h, 42); ctx.fill(); ctx.shadowColor = 'transparent';
          ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(-w / 2 + 48, 0, 24, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(-w / 2 + 38, 1); ctx.lineTo(-w / 2 + 45, 8); ctx.lineTo(-w / 2 + 59, -8); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('BANDE VALIDÉE', -w / 2 + 92, 3);
          ctx.restore();
        }
      } },
    { type: 'flash', at: { say: 'Nice to meet', offset: 1.0 }, dur: 0.2, opacity: 0.35 },

    // la course
    { type: 'text', at: { say: 'next bike race' }, end: { say: 'eat shit out there' }, text: 'Objectif : **battre** **EJ** 🏆', y: 220, size: 92, color: INK, shadow: false, in: 'words', sfx: 'whoosh' },
    { type: 'text', at: { say: 'Come on now' }, end: { say: 'eat shit out there' }, text: '(pas très dur)', y: 390, size: 56, weight: 700, color: '#6b6b70', shadow: false, in: 'up' },

    { type: 'text', at: { say: 'eat shit out there' }, end: { say: 'Woohoo' }, text: 'Règle n°1 : **ne** **pas** **se** **vautrer**', y: 220, size: 88, color: INK, shadow: false, in: 'pop', sfx: 'pop' },
    { type: 'emoji', at: { say: 'I never eat' }, end: { say: 'Woohoo' }, char: '😎', x: 900, y: 420, size: 130, in: 'zoom' },

    { type: 'flash', at: { say: 'Woohoo' }, dur: 0.25, opacity: 0.7 },
    { type: 'text', at: { say: 'Woohoo' }, end: { say: 'come all the way' }, text: "C'est **parti** 🔥", y: 240, size: 130, color: INK, shadow: false, in: 'zoom', sfx: 'whoosh' },

    { type: 'text', at: { say: 'come all the way' }, end: { say: 'plenty of rentals' }, text: 'Venus juste pour **regarder** ? 👀', y: 240, size: 88, color: INK, shadow: false, in: 'pop' },
    { type: 'badge', at: { say: 'plenty of rentals' }, end: { say: 'couple bikes' }, text: 'Motos de location dispo', logo: null, y: 240, size: 64, in: 'down', sfx: 'pop' },
    { type: 'emoji', at: { say: 'plenty of rentals' }, end: { say: 'couple bikes' }, char: '🤘', x: 540, y: 420, size: 130, in: 'spin' },

    { type: 'text', at: { say: 'couple bikes' }, end: { say: 'Tear up' }, text: 'Une petite **course** ? 🏆', y: 240, size: 110, color: INK, shadow: false, in: 'pop', sfx: 'whoosh' },

    // punchline + CTA
    { type: 'stamp', at: { say: 'even a' }, dur: 'end', text: 'ÉVIDEMMENT', y: 1000, size: 78, angle: -8, sfx: 'pop' },
    { type: 'shake', at: { say: 'even a' }, dur: 0.35, amount: 22 },
    { type: 'text', at: { say: 'Tear up' }, dur: 'end', text: 'La course en **partie** **2** 👇', y: 230, size: 96, color: INK, shadow: false, in: 'up' },
    { type: 'arrow', at: { say: 'Tear up', offset: 0.3 }, dur: 'end', from: [860, 330], to: [940, 1500], curve: -0.3, color: '#2f7bff', width: 14 },

    // sous-titres karaoké, sous la vidéo
    { type: 'captions', at: 0, dur: 'end', y: 1720, keywords: ['Ricky', 'Sam', 'Ian', 'Brittany', 'EJ', 'Billy', 'Jason', 'Lucia'], keyColor: '#2f7bff', in: 'none', out: 'none' },
  ],
};
