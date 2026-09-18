import fs from 'fs';
import path from 'path';
import { ProjectDatabaseReport } from '../../shared/types';
import { DatabaseEvidence, detectDatabases } from './database-detector';

/**
 * The files worth reading to find out what a project stores its data in.
 *
 * A fixed list rather than a scan: opening a user's project must not turn into
 * a walk of their whole tree, and every one of these is a file a project puts
 * its database configuration in on purpose. Anything missing is simply not read.
 */
const CANDIDATES = [
  'package.json',
  'composer.json',
  'requirements.txt',
  'requirements-dev.txt',
  'pyproject.toml',
  'Pipfile',
  'go.mod',
  'Gemfile',
  'prisma/schema.prisma',
  'drizzle.config.ts',
  'drizzle.config.js',
  'drizzle.config.json',
  'typeorm.config.ts',
  'ormconfig.json',
  'sequelize.config.js',
  'knexfile.js',
  'knexfile.ts',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.example',
  '.env.sample',
  '.env.template'
];

/** A guard against reading something enormous by accident. */
const MAX_BYTES = 400_000;

/**
 * Reads the candidate files and hands them to the detector.
 *
 * Nothing here decides anything: it collects what exists and hands it over, so
 * the decision stays in the pure `detectDatabases`, where it can be tested
 * against real project shapes without touching a disk.
 */
export function collectDatabaseEvidence(projectPath: string): DatabaseEvidence {
  const files: Record<string, string> = {};
  const filenames: string[] = [];

  try {
    for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
      if (entry.isFile() || entry.isDirectory()) filenames.push(entry.name);
    }
  } catch {
    return { files, filenames };
  }

  for (const relative of CANDIDATES) {
    const absolute = path.join(projectPath, relative);
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_BYTES) continue;
      files[relative] = fs.readFileSync(absolute, 'utf8');
    } catch {
      // Absent files are the normal case: most projects have a few of these.
    }
  }

  return { files, filenames };
}

/** What the project is built on, read from the project itself. */
export function inspectProjectDatabase(projectPath: string): ProjectDatabaseReport {
  return detectDatabases(collectDatabaseEvidence(projectPath));
}
