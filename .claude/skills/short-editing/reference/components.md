# Référence des composants (`spec.js > elements[]`)

Props communes à **tous** les éléments :

| prop | description |
|---|---|
| `type` | nom du composant |
| `at` | début : secondes (sortie) ou `{ say: 'phrase', occurrence?, offset?, edge? }` |
| `end` / `dur` | fin : `end` (même format que `at`, coupe au début de la phrase), `dur` en secondes, ou `dur: 'end'` |
| `in` | entrée : `pop` (défaut), `fade`, `zoom`, `up`, `down`, `left`, `right`, `blur`, `spin`, `wipe`, `words` (texte mot à mot), `none` |
| `out` | sortie : `fade` (défaut), mêmes valeurs, `none` |
| `inDur` / `outDur` | durées d'entrée/sortie (0.35 / 0.25) |
| `z` | ordre d'empilement (sinon ordre du tableau) |
| `opacity`, `scale`, `rotate` (deg), `float` (flottement, px) | transformations |
| `sfx` | `'pop'`, `'whoosh'` ou chemin → joué à l'apparition (`sfxGain`, `sfxOffset`) |
| `disabled: true` | désactive l'élément |

Positions : px du canvas (1080×1920 en 9:16) ou chaînes `'50%'`. `box: [x, y, w, h]`.
Texte riche : `**mot**` = couleur accent.

## background
`color` | `gradient: ['#a', '#b']`, `angle` · `grid: true|px` (grille animée) · `vignette: true|0.4`

## camera — le rush principal, synchronisé aux cuts
`source` ('main') · `box` (plein écran par défaut) · `fit` ('cover'|'contain') · `focus: [0.5, 0.3]` (point de cadrage) ·
`zoom` · `punch: true|1.12` (zoom alterné à chaque jump-cut) · `zooms: [{ at, scale: 1.25, dur: 0.5, hold: 1.5 }]` ·
`radius`, `border: { width, color }`, `shadow`, `mirror`

## clip — b-roll (autre source de `project.json`)
Comme `camera` + `source: 'broll1'`, `start` (s dans le clip), `rate`.

## image
`src: 'assets/logo.svg'` · `x`, `y` (centre) · `w` / `h` · `fit` · `radius` · `bg`, `pad` (fond carte) · `shadow` · `kenburns: true`

## text
`text` · `x`, `y` · `size` (auto-réduit pour tenir) · `maxWidth`, `maxLines` · `align` · `weight` · `font` · `color`, `accent` ·
`bg: true|'#000c'` (pill), `padding`, `radius` · `stroke: { width, color }` · `uppercase` · `stagger` (mot à mot) · `shadow: false`

## captions — sous-titres karaoké
Hérite de `style.json > theme.captions`. `y` · `size` · `weight` · `maxWords` (3) · `maxChars` · `uppercase` · `color` ·
`highlight` (mot actif) · `highlightBg` (pastille derrière le mot actif) · `stroke: false`, `strokeWidth`, `strokeColor` ·
`pop: false` · `keywords: ['Remotion']` + `keyColor` · `dimUnspoken` · `wordGap`

## counter — chiffre animé
`from`, `to`, `decimals`, `prefix`, `suffix`, `suffixColor`, `locale` ('fr-FR' → 106,3) · `countDur`, `ease` · `size`, `color`, `x`, `y` · `label`

## badge — pastille logo + nom
`text`, `logo`, `x`, `y`, `size`, `bg`, `color`

## card — panneau
`box` · `title`, `text`, `value`, `logo`, `logoSize` · `bg`, `color`, `border`, `radius`, `pad`

## bars — comparatif en barres
`box` · `items: [{ label, value, logo?, color?, display? }]` · `max` · `unit` · `decimals` · `highlight` (index) · `stagger`, `growDur` · `labelColor`, `valueColor`

## progress — barre de progression / fenêtre de rendu
`box: [x, y, w, h]` · `fillDur` · `frames: 1600` (compteur "Frame n / 1600") · `time: 106` (chrono) · `label` · `color`, `textColor`

## list — puces qui apparaissent
`items: ['…']` · `times: [{ say }, …]` (une apparition par puce, calée sur la parole) ou `stagger` · `icon` ('✓') · `x`, `y`, `size`, `color`, `iconColor`

## arrow — flèche courbe qui se dessine
`from: [x, y]`, `to: [x, y]` · `curve` (0.3) · `width`, `color`, `head`, `headSize`, `dashed` · `drawDur`

## circle / highlight — entourage qui se dessine
`x`, `y` (centre), `w`, `h` · `shape: 'rect'` (ou `type: 'highlight'`) · `color`, `width`, `fill`, `radius`, `drawDur`

## stamp — tampon qui s'écrase
`text`, `x`, `y`, `size`, `angle`, `color`

## emoji
`char`, `x`, `y`, `size`, `wobble: false`

## rect
`box`, `color`, `radius`

## flash — flash plein écran (transition)
`color`, `opacity`, `dur` (0.25 conseillé)

## shake — tremblement de tout l'écran
`amount` (px), `dur`

## custom — dessin sur mesure
```js
{ type: 'custom', at: { say: 'rendu' }, dur: 3,
  async prepare(s) { this.logo = await s.img('assets/x.png'); },   // optionnel
  draw(ctx, s) {
    const { E, clamp, roundRect, spring } = s.helpers;
    const k = E.outCubic(clamp(s.local / 0.6));        // s.local = temps depuis le début de l'élément
    ctx.fillStyle = s.theme.colors.accent;
    roundRect(ctx, 100, 400, 880 * k, 60, 30); ctx.fill();
  } }
```
`s` : `t` (temps global), `local`, `dur`, `p` (0→1), `W`, `H`, `theme`, `words` (mots du montage), `font(weight, size, family)`, `img(src)`, `frame(source, time)`, `helpers`.
