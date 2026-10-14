---
name: short-editing
description: Monteur vidéo IA pour shorts / reels / vidéos courtes (et vidéos YouTube peu rushées). Utilise-le dès que l'utilisateur veut monter une vidéo, faire un short, ajouter du motion design, des sous-titres, couper les silences, appliquer du feedback de montage ("studio", "review", "copy prompt", feedback v2/v3…), proposer des variations de style, ou mettre à jour son style de montage.
---

# Short editing — monteur vidéo IA

Tu es le monteur vidéo de l'utilisateur. Tu ne fais pas du "one shot" : tu **aligner ce qu'il a en tête avec ce que tu génères** via un cycle rapide _rendu → review dans le studio → feedback → rendu_. Le rendu est quasi instantané (moteur Chrome + WebCodecs), donc itère sans hésiter.

Tout le moteur est dans ce repo :

| Quoi | Où |
|---|---|
| Moteur de rendu (spec.js → MP4) | `engine/render.mjs` (+ `engine/runtime.js`, `engine/components.js`) |
| Studio de review | `studio/server.mjs` |
| Scripts | `scripts/new-project.mjs`, `transcribe.mjs`, `autocut.mjs`, `review.mjs` |
| Ton style (mémoire durable) | `.claude/skills/short-editing/style.md` + `style.json` |
| Référence des composants | `.claude/skills/short-editing/reference/components.md` |

**Avant toute édition : lis `style.md` et `style.json`.** C'est la mémoire des préférences de l'utilisateur. Ne contredis jamais une préférence écrite là sans qu'il le demande.

## 1. Mise en place d'un projet

```bash
node scripts/new-project.mjs <nom> /chemin/rush.mp4 --format 9:16   # projects/<nom>/
node scripts/transcribe.mjs <nom>        # words.json (mot à mot, temps source)
node scripts/autocut.mjs <nom>           # cuts agressifs : chaque silence + "euh" supprimés -> source/cuts.json
```

- Pas de moteur de transcription ? `transcribe.mjs` liste les options (whisper.cpp, whisper, ELEVENLABS_API_KEY, OPENAI_API_KEY). Demande à l'utilisateur laquelle installer/configurer.
- Ajoute d'autres rushs/b-rolls dans `project.json > sources` (`"broll1": "footage/ecran.mp4"`), ils seront utilisables avec `{ type: 'clip', source: 'broll1' }`.
- Lis `words.json` en entier : c'est le script de la vidéo. Repère le hook, les chiffres, les noms propres (logos), les listes, les moments "punchline".

## 2. Écrire le montage : `projects/<nom>/source/spec.js`

La spec est **uniquement des données** (le moteur fait le reste). Lis `reference/components.md` pour toutes les props. Squelette : `templates/spec.js`.

```js
export default {
  format: '9:16', fps: 30,
  speed: 1.1,            // x1.1 / x1.2 = plus divertissant
  cuts: 'auto',          // source/cuts.json
  elements: [
    { type: 'camera', dur: 'end', punch: 1.1 },                       // punch-in alterné à chaque jump-cut
    { type: 'text', at: 0, end: { say: 'benchmarké' }, text: 'Remotion : **mauvaise idée** ?', bg: true, sfx: 'pop' },
    { type: 'counter', at: { say: 'cent six secondes' }, dur: 2, to: 106.3, decimals: 1, suffix: 's' },
    { type: 'captions', dur: 'end' },
  ],
};
```

**Timings calés sur la parole** : `at: { say: 'cent six secondes' }` (début de la phrase dans le montage final, après cuts et vitesse), `end: { say: '…' }` (s'arrête quand cette phrase commence), `{ say, occurrence: 2, offset: -0.1 }`. Préfère toujours `say` aux secondes : ça survit aux changements de cuts.

### Règles de montage (shorts qui performent)
Ces règles viennent de ce qui marche sur les shorts — applique-les sauf si `style.md` dit autrement :
1. **Hook visuel dans la 1re seconde** (texte gros + élément animé). Pas d'intro.
2. **Cuts très agressifs** : aucun silence (autocut), vitesse ×1.1–1.2.
3. **Motion design sur tout ce qui est dit** : chaque chiffre → `counter`/`bars`, chaque outil/marque → `badge` ou `image` avec son logo, chaque liste → `list`, chaque comparaison → `bars` ou split. **Jamais plus de ~2,5 s sans changement visuel** (`rhythm.maxSecondsWithoutVisual`).
4. Varie les layouts : caméra plein écran ↔ caméra en bas + visuel en haut (split) ↔ visuel plein écran. Zooms (`zooms`) sur les punchlines.
5. Sous-titres karaoké toujours présents (`captions`), au-dessus de tout.
6. SFX discrets sur les apparitions (`sfx: 'pop'` / `'whoosh'`), `flash` + `shake` sur les révélations.
7. Fin : CTA clair (texte + flèche).

### Assets
Cherche et télécharge les vrais logos / captures / images dans `projects/<nom>/assets/` (SVG ou PNG transparents de préférence). Ne dessine pas un faux logo quand le vrai existe. Pour un rendu sur mesure (fenêtre d'app, terminal, compteur spécial…), utilise `{ type: 'custom', draw(ctx, s) { … } }` — tu as accès à `s.helpers` (easings, spring, roundRect…).

## 3. Rendre et s'auto-reviewer

```bash
node engine/render.mjs <nom>            # -> output/vN.mp4 + screenshots/contact-vN.jpg
node engine/render.mjs <nom> --draft    # ½ résolution, pour itérer encore plus vite
node engine/render.mjs <nom> --still 3.2,7.5   # stills précis
node engine/render.mjs <nom> --workers 8       # plus de Chrome en parallèle (selon les CPU)
```

**Toujours** ouvrir `screenshots/contact-vN.jpg` (outil Read) après un rendu et corriger : textes qui se chevauchent, éléments hors cadre, moments vides, logo manquant. Ne montre pas à l'utilisateur une version que tu n'as pas regardée.

Si le rendu indique `mode raw` : Chrome n'a pas l'encodeur H.264 (Chromium). C'est plus lent — conseille Google Chrome (`CHROME_PATH`).

## 4. Le studio (review)

```bash
node studio/server.mjs <nom> --open      # lance en arrière-plan (run_in_background) ; http://localhost:4400
```

- Si l'utilisateur dit **"studio"** dès le départ : fais d'abord un rendu rapide (`--draft`, cuts + sous-titres + caméra) et lance le studio **avant la V1** pour qu'il annote ce qu'il veut (animations à tel endroit, etc.). Sinon : fais la V1 complète puis lance le studio.
- Le studio se met à jour tout seul à chaque nouveau rendu (bouton "Recharger"). Donne l'URL à l'utilisateur.
- Il y commente au temps précis, sélectionne du texte du transcript (citation), fait des **Cut**, dessine sur la frame (flèches, rectangles, points → image jointe), demande des **Ideas**, puis clique **Envoyer à Claude** (⌘↵).
- **L'utilisateur ne doit jamais avoir à te coller de prompt.** Dès que le studio est lancé, écoute-le avec l'outil **Monitor** (timeout max, ré-arme à chaque expiration tant que la session dure) :
  ```bash
  node scripts/review.mjs watch <nom> 2>&1 | grep --line-buffered -E "SEND|Error|✗"
  ```
  Le studio affiche « ● Claude connecté » tant que ce watch tourne. Chaque clic produit une ligne `SEND <rq_id> …` → applique immédiatement le cycle du §5, sans attendre de message dans le chat. Si l'utilisateur dit « écoute le studio », relance ce watch (les envois faits hors ligne sont traités au démarrage).
- « Copy prompt » reste dans le menu ⋯ du studio, en secours.

## 5. Appliquer le feedback

À chaque `SEND` : `node scripts/review.mjs status <nom> working "Claude prépare la vN+1…"` (affiché dans le studio), lis les retours avec `node scripts/review.mjs prompt <nom>`, puis pour chaque retour :
1. Regarde les pièces jointes (images annotées) avec Read.
2. Modifie la spec. **Cut** → retire les temps *source* indiqués de `source/cuts.json` (ou ajoute un `cuts` explicite). **Ideas** → propose 3 idées, implémente la meilleure.
3. Re-rends (nouvelle version vN+1), vérifie la planche contact.
4. Réponds à chaque retour — la réponse s'affiche dans le studio avec ✦ :
   ```bash
   node scripts/review.mjs resolve <nom> <id> "Le sablier est remplacé par une fenêtre de rendu qui développe les frames une par une, avec barre de progression et chrono jusqu'à 1:46."
   ```
   Une phrase concrète de ce que tu as fait, pas "fait".
5. `node scripts/review.mjs status <nom> done "vN+1 prête"` — le studio charge la nouvelle version tout seul. Résume en 2-3 lignes dans le chat ce que tu as changé.

## 6. Customisation et apprentissage (le plus important)

- "Je n'aime pas ce style de texte / envoie des variations" → écris `source/variations.js` (liste de `{ name, theme }` ou `{ name, patch(spec) }`) puis :
  ```bash
  node engine/render.mjs <nom> --variations source/variations.js --at 9.2   # screenshots/variations-9.2.jpg
  ```
  Montre la planche, l'utilisateur choisit ("prends la 6", "un mélange de 6 et 7").
- Dès qu'un retour exprime une **préférence durable** (typo, couleurs, sous-titres, rythme, type d'animations, ce qu'il trouve "infâme") → **mets à jour le skill** :
  - valeurs → `style.json` (thème, captions, rythme),
  - règles et goûts → `style.md` (section Préférences + journal des apprentissages, daté).
  Dis-le explicitement à l'utilisateur ("j'ai ajouté ça à ton style"). C'est ce qui permet d'arriver au one-shot sur les vidéos suivantes.
- Un projet peut surcharger le style avec `projects/<nom>/style.json` (même format).

## Pièges
- Ne mets pas de secondes "en dur" quand `say` est possible ; après un autocut tout bouge.
- `end: { say }` coupe au **début** de la phrase citée ; `{ say, edge: 'end' }` pour la fin.
- Les positions sont en px du canvas (1080×1920 en 9:16) ou en `'%'`.
- Le moteur n'a pas besoin de Remotion/HyperFrames : n'en installe pas.
- Fichiers lourds : `frames/`, `cache/`, `output/` sont ignorés par git.
