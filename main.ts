// Harness driver: loads every case from cases.json, renders each one
// with parse() from parse.js, and stores the HTML strings, in input
// order, as the JSON array in html.json.
//
// The input and output directories are taken from the environment when
// the harness provides them, and otherwise use the harness defaults.
// Erasable TypeScript only — Node 22+ runs this file directly with
// type stripping, so there is no build step and no dependency to install.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

interface MarkdownCase {
  id: string;
  markdown: string;
}

function run(): void {
  const inDir: string = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const text: string = readFileSync(join(inDir, 'cases.json'), 'utf8');
  const cases: MarkdownCase[] = JSON.parse(text) as MarkdownCase[];
  const rendered: string[] = new Array<string>(cases.length);
  for (let n = 0; n < cases.length; n++) {
    rendered[n] = parse(cases[n].markdown);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'html.json'), JSON.stringify(rendered));
}

run();
