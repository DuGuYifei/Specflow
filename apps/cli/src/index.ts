#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { readSpecflowDocs } from '@specflow/specflow-kit';

const program = new Command();

function getRepoRoot(): string {
  return resolve(process.cwd());
}

function requiredPaths(rootDir: string): string[] {
  return ['apps', 'packages', '.specflow', 'docs'].map((entry) => resolve(rootDir, entry));
}

program
  .name('specflow')
  .description('Specflow CLI (Phase 0 placeholder).')
  .version('0.1.0');

program
  .command('doctor')
  .description('Validate deterministic local repository structure.')
  .action(() => {
    const rootDir = getRepoRoot();
    const missing = requiredPaths(rootDir).filter((entry) => !existsSync(entry));

    if (missing.length > 0) {
      console.log('SPECFLOW_DOCTOR: FAIL');
      console.log(`Missing paths: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    console.log('SPECFLOW_DOCTOR: OK');
    console.log('Phase 0 repository structure detected.');
  });

const spec = program.command('spec').description('Read .specflow knowledge documents.');

spec
  .command('read')
  .description('Read key .specflow markdown files.')
  .action(async () => {
    const docs = await readSpecflowDocs(getRepoRoot());
    console.log('SPECFLOW_SPEC_READ: OK');
    console.log(`Project lines: ${docs.project.split('\n').length}`);
    console.log(`Architecture lines: ${docs.architecture.split('\n').length}`);
    console.log(`Conventions lines: ${docs.conventions.split('\n').length}`);
    console.log(`Glossary lines: ${docs.glossary.split('\n').length}`);
    console.log(`Phase0 workflow lines: ${docs.phase0Workflow.split('\n').length}`);
  });

const workflow = program.command('workflow').description('Workflow graph commands (Phase 0).');

workflow
  .command('validate')
  .description('Validate minimal Phase 0 workflow topology files are present.')
  .action(() => {
    const rootDir = getRepoRoot();
    const workflowPath = resolve(rootDir, '.specflow/workflows/phase-0.md');

    if (!existsSync(workflowPath)) {
      console.log('SPECFLOW_WORKFLOW_VALIDATE: FAIL');
      console.log('Expected .specflow/workflows/phase-0.md to exist.');
      process.exitCode = 1;
      return;
    }

    console.log('SPECFLOW_WORKFLOW_VALIDATE: OK');
    console.log('Phase 0 workflow intent file is available.');
  });

void program.parseAsync(process.argv);
