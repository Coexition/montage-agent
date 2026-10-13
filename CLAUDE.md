# montage-agent

Monteur vidéo IA : moteur de rendu (`engine/`), studio de review (`studio/`), scripts (`scripts/`), skill `.claude/skills/short-editing`.

- Pour tout montage / feedback vidéo : utilise le skill **short-editing** (lis son SKILL.md, puis `style.md` et `style.json`).
- Code : ESM pur, Node ≥ 20, aucune dépendance hors `playwright-core`. Le runtime navigateur (`engine/runtime.js`, `components.js`, `timeline.js`, `anim.js`) ne doit rien importer de Node.
- Tout rendu doit rester déterministe : une frame = fonction pure du temps (pas de `Math.random`, pas d'état entre frames ; utilise `rand(seed)` / `wiggle` de `anim.js`).
- Tests : `npm test` (selftest de bout en bout sur `projects/demo`).
- Chrome : `CHROME_PATH` pour forcer un binaire. Google Chrome = mode H.264 rapide ; Chromium = fallback raw.
