/**
 * CLI: type-level data-flow reasoning over a `.schema`, driven by a `.flow` file.
 *
 *   npx ts-node src/flow-cli.ts examples/vpc-egress.flow
 *   npx ts-node src/flow-cli.ts examples/vpc-egress.flow --from PrivateSubnet --to IGW
 *   npx ts-node src/flow-cli.ts examples/vpc-egress.flow --reach PrivateSubnet
 *
 * With no query it prints every derived flow edge and, for each object, the set
 * of objects it can reach. `--from X --to Y` answers a single reachability
 * question (with the witnessing path); `--reach X` lists everything X reaches.
 */

import * as path from 'path';
import { reaches, flowPaths, isFunctional } from '../../core/src';
import { analyzeFlowFile } from './analyze-flow';

interface CliOptions {
  file: string;
  from?: string;
  to?: string;
  reach?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const opts: Partial<CliOptions> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from') opts.from = args[++i];
    else if (a === '--to') opts.to = args[++i];
    else if (a === '--reach') opts.reach = args[++i];
    else if (!a.startsWith('-')) opts.file = a;
  }
  if (!opts.file) {
    console.error(
      'usage: flow-cli <file.flow> [--from A --to B] [--reach A]',
    );
    process.exit(2);
  }
  return opts as CliOptions;
}

function showPath(p: string[]): string {
  return p.length === 0 ? 'id' : p.join(' * ');
}

function main(): void {
  const opts = parseArgs(process.argv);
  const { flow, schemaPath } = analyzeFlowFile(path.resolve(opts.file));

  console.log(`\nFlow: ${opts.file}  (over ${path.basename(schemaPath)})\n`);

  // Single reachability question.
  if (opts.from && opts.to) {
    const ok = reaches(flow, opts.from, opts.to);
    console.log(`${opts.from} ⇝ ${opts.to} : ${ok ? 'REACHABLE' : 'not reachable'}`);
    if (ok) {
      for (const p of flowPaths(flow, opts.from, opts.to)) {
        const fn = isFunctional(flow, p) ? 'functional' : 'relational';
        console.log(`    via ${showPath(p)}   [${fn}]`);
      }
    }
    return;
  }

  // Everything a single object reaches.
  if (opts.reach) {
    printReachable(flow, opts.reach);
    return;
  }

  // Default: the derived edges, then a reachability summary per object.
  console.log('Derived flow edges:');
  for (const [name, info] of flow.edgeInfo) {
    const fn = info.functional ? 'functional' : 'relational';
    console.log(`    ${name}: ${info.from} → ${info.to}   [${fn}]`);
  }
  console.log('');

  for (const obj of [...flow.category.objects].sort()) {
    printReachable(flow, obj);
  }
}

function printReachable(flow: ReturnType<typeof analyzeFlowFile>['flow'], from: string): void {
  const targets = [...flow.category.objects]
    .filter(o => o !== from && reaches(flow, from, o))
    .sort();
  if (targets.length === 0) {
    console.log(`${from} ⇝ (nothing)`);
  } else {
    console.log(`${from} ⇝ ${targets.join(', ')}`);
  }
}

main();
