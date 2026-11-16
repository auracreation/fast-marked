// Driver for the make.fun harness: read every case from cases.json,
// render each one with the fast-marked parse() from parse.js, and write
// the resulting HTML strings, in input order, to html.json.
//
// Input and output directories come from the environment when the
// harness sets them, and fall back to the harness defaults otherwise.
// This file is plain erasable TypeScript: it runs under Node 22+ with
// type stripping and needs no build step or dependencies.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

type InputCase = { id: string; markdown: string };

function main(): void {
  const inputDir: string = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const raw: string = readFileSync(join(inputDir, 'cases.json'), 'utf8');
  const cases: InputCase[] = JSON.parse(raw) as InputCase[];
  const html: string[] = new Array<string>(cases.length);
  for (let index = 0; index < cases.length; index++) {
    html[index] = parse(cases[index].markdown);
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
}

main();
