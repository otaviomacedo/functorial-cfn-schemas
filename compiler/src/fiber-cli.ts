/**
 * CLI: static fiber analysis of a `.schema` file.
 *
 *   npx ts-node src/fiber-cli.ts examples/vpc.schema
 *   npx ts-node src/fiber-cli.ts examples/apigw.schema --verify
 *
 * Prints, per CloudFormation-resource object, its fiber and cardinality class —
 * the same information the planned two-panel app will render as a graph.
 */

import * as path from 'path';
import { analyzeSchemaFile } from './analyze-schema';
import { verifyCardinality } from '../../core/src';

interface CliOptions {
  file: string;
  verify: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let file: string | undefined;
  let verify = false;
  let json = false;
  for (const a of args) {
    if (a === '--verify') verify = true;
    else if (a === '--json') json = true;
    else if (!a.startsWith('-')) file = a;
  }
  if (!file) {
    console.error('usage: fiber-cli <file.schema> [--verify] [--json]');
    process.exit(2);
  }
  return { file, verify, json };
}

const KIND_LABEL: Record<string, string> = {
  singleton: 'singleton (auto-created)',
  correlated: '1:1 correlated',
  product: 'product',
};

function main(): void {
  const opts = parseArgs(process.argv);
  const result = analyzeSchemaFile(path.resolve(opts.file));
  const { analysis } = result;

  if (opts.json) {
    console.log(JSON.stringify(analysis, replacer, 2));
    return;
  }

  console.log(`\nFiber analysis: ${opts.file}\n`);

  // Group the printout by fiber, preserving class order within each.
  const width = Math.max(...analysis.classes.map(c => c.object.length), 8);
  for (const [fiber, objects] of analysis.fibers) {
    console.log(`■ fiber ${fiber}`);
    for (const obj of objects) {
      const cls = analysis.classes.find(c => c.object === obj)!;
      const kind = KIND_LABEL[cls.kind];
      const eq = cls.collapsingEquations.length
        ? `  [${cls.collapsingEquations.length} equation${cls.collapsingEquations.length > 1 ? 's' : ''}]`
        : '';
      console.log(`    ${obj.padEnd(width)}  ${cls.cardinalityFormula.padEnd(22)} ${kind}${eq}`);
    }
    console.log('');
  }

  if (analysis.crossFiberMorphisms.length > 0) {
    console.log('Cross-fiber references:');
    for (const m of analysis.crossFiberMorphisms) {
      console.log(`    ${m.source} → ${m.target}   (${m.fromFiber} ⇒ ${m.toFiber})`);
    }
    console.log('');
  }

  if (opts.verify) {
    process.stdout.write('Verifying cardinalities against the Kan engine… ');
    const mismatches = verifyCardinality(result.functor, analysis, { ks: [1, 2, 3] });
    if (mismatches.length === 0) {
      console.log('OK (all predictions match).');
    } else {
      console.log(`${mismatches.length} MISMATCH(ES):`);
      for (const m of mismatches) {
        console.log(`    ${m.object}: predicted ${m.predicted}, actual ${m.actual} at ${JSON.stringify(m.cardinalities)}`);
      }
      process.exitCode = 1;
    }
  }
}

/** JSON replacer that renders Maps as plain objects. */
function replacer(_key: string, value: any): any {
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

main();
