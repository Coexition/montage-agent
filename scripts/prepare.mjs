#!/usr/bin/env node
// Extrait frames + audio des rushs (fait automatiquement par render.mjs si nécessaire).
//   node scripts/prepare.mjs <projet> [--force]
import { resolveProject, parseArgs } from '../engine/lib/project.mjs';
import { prepareProject } from '../engine/prepare.mjs';

const args = parseArgs(process.argv.slice(2));
const out = await prepareProject(resolveProject(args._[0]), { force: !!args.force });
console.log(JSON.stringify(out, null, 2));
