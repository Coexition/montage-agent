# montage-agent

Un monteur vidéo IA piloté par Claude Code :

- **un moteur de rendu ultra léger** : `spec.js` (des données) → Chrome headless dessine chaque frame sur un `<canvas>` → **WebCodecs H.264 encode directement dans Chrome** → ffmpeg muxe en `-c copy`. Pas de React, pas de bundler, pas de 600 Mo de dépendances (1 seule : `playwright-core`) ;
- **un studio de review** dans le navigateur : lecteur, transcription mot à mot, commentaires horodatés, cuts, dessin sur la frame, « Ideas », et **Copy prompt** pour renvoyer tous les retours à l'agent ;
- **un skill Claude Code** (`.claude/skills/short-editing`) qui fait le montage, applique le feedback, propose des variations et **apprend ton style** (`style.md` / `style.json`).

```
rush.mp4 ─► transcribe ─► words.json ─► autocut ─► cuts.json
                                          │
                       Claude écrit  source/spec.js  (motion design calé sur la parole)
                                          │
                     engine/render.mjs ── N × Chrome headless ── canvas ── WebCodecs H.264
                                          │                                     │
                                  audio (ffmpeg: cuts, ×1.1, sfx, musique)      │
                                          └──────────── mux -c copy ◄───────────┘
                                                        │
                                                 output/vN.mp4
                                                        │
              studio  ◄── review (commentaires, cuts, dessins) ──► Copy prompt ──► Claude ──► vN+1
```

## Démarrage

Prérequis : Node ≥ 20, ffmpeg, **Google Chrome** (recommandé : il embarque l'encodeur H.264 WebCodecs ; avec Chromium le moteur bascule sur un fallback `raw → libx264` plus lent).

```bash
npm install
npm run demo                       # crée projects/demo (faux rush + transcription) 
node scripts/autocut.mjs demo      # coupe les silences
node engine/render.mjs demo        # → projects/demo/output/v1.mp4
node studio/server.mjs demo --open # → http://localhost:4400
```

Avec Claude Code, il suffit de dire par exemple :

> Monte un short à partir de ~/Desktop/rush.mp4, motion design maxing, et lance le studio.

Le skill `short-editing` se charge du reste (projet, transcription, cuts, spec, rendu, auto-review, studio).

## Le cycle de feedback

1. Claude rend la V1 et lance le studio.
2. Dans le studio : <kbd>C</kbd> pour commenter au temps courant, sélectionne des mots du transcript pour citer un passage, onglet **Cut** pour marquer un passage à supprimer (<kbd>I</kbd>/<kbd>O</kbd> pour les bornes), <kbd>P</kbd> pour dessiner (flèches, rectangles, points, main levée) — la frame annotée est jointe au commentaire. **Ideas** demande des propositions de motion design.
3. **Copy prompt** → colle dans Claude Code. (Claude peut aussi le lire directement : `node scripts/review.mjs prompt demo`.)
4. Claude modifie la spec, re-rend (quelques secondes), et répond à chaque retour (`review.mjs resolve`) : les réponses ✦ apparaissent en direct dans le studio, qui propose de recharger la nouvelle version.
5. Les préférences durables sont écrites dans le skill → le prochain montage part déjà dans ton style.

Les retours sont stockés en local (`reviews/feedback.json`, `reviews/attachments/`). Les temps « source » (dans le rush) sont enregistrés en plus des temps de la version, donc un retour fait sur la v2 reste bien placé dans la v3 même si les cuts ont changé.

## Commandes

| Commande | Rôle |
|---|---|
| `node scripts/new-project.mjs <nom> rush.mp4 [--format 9:16]` | crée `projects/<nom>` |
| `node scripts/transcribe.mjs <nom> [--engine …]` | `words.json` mot à mot (whisper.cpp, whisper, ElevenLabs, OpenAI) |
| `node scripts/autocut.mjs <nom> [--gap 0.25]` | cuts agressifs (silences + « euh ») → `source/cuts.json` |
| `node engine/render.mjs <nom>` | rendu → `output/vN.mp4` + planche contact |
| `… --draft` / `--workers 8` / `--codec raw` | ½ résolution / parallélisme / forcer le fallback |
| `… --still 3.2,7` / `--contact 15` | stills / planche contact → `screenshots/` |
| `… --variations source/variations.js --at 9` | planche de variantes de style au même instant |
| `node studio/server.mjs <nom> [--open]` | studio de review (+ `/preview` : lecture live de la spec dans Chrome, sans rendu) |
| `node scripts/review.mjs prompt\|list\|resolve\|reopen <nom> …` | feedback côté agent |
| `npm test` | selftest de bout en bout |

## Structure d'un projet

```
projects/<nom>/
  project.json          { name, format, sources: { main: "footage/rush.mp4" } }
  footage/              rushs
  assets/               logos, images, sfx/
  source/spec.js        le montage (données) — source/cuts.json — source/variations.js
  words.json            transcription (temps source)
  frames/<source>/      frames JPEG (décodées une seule fois par ffmpeg)
  output/vN.mp4         versions (+ poster, métadonnées, transcription alignée)
  reviews/              feedback du studio + images annotées
  screenshots/          planches contact, stills, variations
```

## Pourquoi ce moteur est rapide

- **Encodage dans Chrome** (WebCodecs, matériel quand dispo) : le flux H.264 Annex B sort tel quel, chaque worker encode sa tranche, les tranches sont concaténées et muxées sans ré-encodage.
- **Décodage des rushs une seule fois** par ffmpeg en JPEG ; Chrome ne fait que `createImageBitmap` + `drawImage`.
- **Canvas 2D déterministe** : chaque frame est une fonction pure du temps → découpage trivial en N Chrome parallèles.
- **Spec = données** (~100 lignes pour un short) : l'IA écrit peu de code, donc vite et avec peu d'erreurs.

Mesures dans un conteneur 4 vCPU sans GPU, 1080×1920 @ 30 fps : **~65 fps** en mode H.264 WebCodecs (un short de 23 s rendu en ~11 s), ~23 fps en fallback raw/libx264. Sur un Mac avec Chrome (encodeur matériel), c'est plus rapide encore.

## Limites connues

- Pas de moteur de transcription embarqué : installe whisper.cpp/whisper ou fournis une clé ElevenLabs/OpenAI.
- Les vidéos très longues avec beaucoup de rushs (multicam, heures de footage) restent le terrain d'un monteur humain.
- Le dossier `frames/` peut être volumineux (≈ 150–250 Ko par frame en 1080p) ; il est régénérable et ignoré par git.
