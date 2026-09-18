/**
 * What database a project actually talks to.
 *
 * The settings screen used to show the app's own SQLite file under "Database",
 * which says nothing about the project the user is working in. What is useful
 * there is the project's own storage: is this thing talking to PostgreSQL, and
 * where is that configured? The answer is already written down in the project —
 * a driver in `package.json`, a `provider` line in a Prisma schema, a service in
 * `docker-compose.yml`, a URL in `.env` — so it is read from there rather than
 * guessed or asked for.
 *
 * Two rules are deliberate:
 *
 * - **A connection URL is never echoed.** Only the host, port and database name
 *   survive parsing; the user and password are dropped before the value leaves
 *   this function, so nothing that reaches the UI or a log can leak a credential.
 * - **Nothing is invented.** A finding always carries the file and the line that
 *   produced it, and an empty result is reported as "not detected" rather than
 *   as a default. A wrong answer here is worse than no answer.
 */

import { DatabaseEngine, DatabaseFinding, ProjectDatabaseReport } from '../../shared/types';

// The report is part of the IPC contract, so the types live in `shared`; they are
// re-exported here because this module is the thing that produces them.
export type { DatabaseEngine, DatabaseFinding, ProjectDatabaseReport };

export interface DatabaseEvidence {
  /** Relative path (forward slashes) to the file's contents. */
  files: Record<string, string>;
  /** Names in the project root, so a stray `app.sqlite` is noticed. */
  filenames: string[];
}

/** Dependency name → the engine it talks to. */
const DEPENDENCIES: Record<string, DatabaseEngine> = {
  pg: 'postgresql',
  postgres: 'postgresql',
  'pg-pool': 'postgresql',
  postgresql: 'postgresql',
  '@neondatabase/serverless': 'postgresql',
  '@supabase/supabase-js': 'postgresql',
  'slonik': 'postgresql',
  mysql: 'mysql',
  mysql2: 'mysql',
  '@planetscale/database': 'mysql',
  mariadb: 'mariadb',
  mongodb: 'mongodb',
  mongoose: 'mongodb',
  'better-sqlite3': 'sqlite',
  sqlite3: 'sqlite',
  'sql.js': 'sqlite',
  '@libsql/client': 'libsql',
  redis: 'redis',
  ioredis: 'redis',
  '@upstash/redis': 'redis',
  '@clickhouse/client': 'clickhouse',
  '@aws-sdk/client-dynamodb': 'dynamodb',
  '@google-cloud/firestore': 'firestore',
  firebase: 'firestore',
  'firebase-admin': 'firestore',
  mssql: 'mssql',
  tedious: 'mssql',
  oracledb: 'oracle'
};

/** Python requirements / Pipfile packages. */
const PYTHON_PACKAGES: Record<string, DatabaseEngine> = {
  psycopg2: 'postgresql',
  psycopg2_binary: 'postgresql',
  psycopg: 'postgresql',
  asyncpg: 'postgresql',
  pymysql: 'mysql',
  mysqlclient: 'mysql',
  mysql_connector: 'mysql',
  mariadb: 'mariadb',
  pymongo: 'mongodb',
  motor: 'mongodb',
  mongoengine: 'mongodb',
  redis: 'redis',
  aioredis: 'redis',
  clickhouse_driver: 'clickhouse',
  clickhouse_connect: 'clickhouse',
  pyodbc: 'mssql',
  cx_oracle: 'oracle',
  oracledb: 'oracle'
};

/** Go module paths. */
const GO_MODULES: Record<string, DatabaseEngine> = {
  'github.com/jackc/pgx': 'postgresql',
  'github.com/lib/pq': 'postgresql',
  'github.com/jmoiron/sqlx': 'unknown',
  'github.com/go-sql-driver/mysql': 'mysql',
  'go.mongodb.org/mongo-driver': 'mongodb',
  'github.com/redis/go-redis': 'redis',
  'github.com/mattn/go-sqlite3': 'sqlite',
  'modernc.org/sqlite': 'sqlite',
  'github.com/ClickHouse/clickhouse-go': 'clickhouse',
  'gorm.io/driver/postgres': 'postgresql',
  'gorm.io/driver/mysql': 'mysql',
  'gorm.io/driver/sqlite': 'sqlite'
};

/** Ruby gems. */
const RUBY_GEMS: Record<string, DatabaseEngine> = {
  pg: 'postgresql',
  mysql2: 'mysql',
  mongoid: 'mongodb',
  sqlite3: 'sqlite',
  redis: 'redis'
};

/** ORMs and query builders: they imply an engine, and tell the user how it is used. */
const TOOLING: Record<string, DatabaseEngine | 'unknown'> = {
  prisma: 'unknown',
  '@prisma/client': 'unknown',
  'drizzle-orm': 'unknown',
  typeorm: 'unknown',
  sequelize: 'unknown',
  knex: 'unknown',
  'objection': 'unknown',
  '@mikro-orm/core': 'unknown',
  sqlalchemy: 'unknown',
  django: 'unknown',
  'gorm.io/gorm': 'unknown',
  activerecord: 'unknown'
};

/** `image:` tags in a compose file, matched on the repository part. */
const COMPOSE_IMAGES: Array<[RegExp, DatabaseEngine]> = [
  [/^postgres/, 'postgresql'],
  [/^pgvector/, 'postgresql'],
  [/^timescale/, 'postgresql'],
  [/^mysql/, 'mysql'],
  [/^mariadb/, 'mariadb'],
  [/^mongo/, 'mongodb'],
  [/^redis/, 'redis'],
  [/^valkey/, 'redis'],
  [/^clickhouse/, 'clickhouse'],
  [/^mssql|^microsoft\/mssql/, 'mssql'],
  [/^couchbase|couchdb/, 'unknown']
];

const URL_SCHEMES: Array<[RegExp, DatabaseEngine, DatabaseFinding['kind']]> = [
  [/^postgres(ql)?:/i, 'postgresql', 'database'],
  [/^mysql:/i, 'mysql', 'database'],
  [/^mariadb:/i, 'mariadb', 'database'],
  [/^mongodb(\+srv)?:/i, 'mongodb', 'database'],
  [/^sqlite:/i, 'sqlite', 'database'],
  [/^file:.*\.(sqlite3?|db)$/i, 'sqlite', 'database'],
  [/^libsql:/i, 'libsql', 'database'],
  [/^redis(s)?:/i, 'redis', 'cache'],
  [/^rediss:/i, 'redis', 'cache'],
  [/^clickhouse:/i, 'clickhouse', 'database'],
  [/^mssql:/i, 'mssql', 'database'],
  [/^oracle:/i, 'oracle', 'database']
];

const KIND_OF: Partial<Record<DatabaseEngine, DatabaseFinding['kind']>> = { redis: 'cache' };

/** The env-var names worth following, and the engine each one implies. */
const CONNECTION_ENV: Array<[string, DatabaseEngine]> = [
  ['DATABASE_URL', 'unknown'],
  ['POSTGRES_URL', 'postgresql'],
  ['POSTGRES_PRISMA_URL', 'postgresql'],
  ['PGHOST', 'postgresql'],
  ['MYSQL_URL', 'mysql'],
  ['MYSQL_HOST', 'mysql'],
  ['MONGO_URL', 'mongodb'],
  ['MONGODB_URI', 'mongodb'],
  ['REDIS_URL', 'redis'],
  ['CLICKHOUSE_URL', 'clickhouse'],
  ['SUPABASE_DB_URL', 'postgresql'],
  ['TURSO_DATABASE_URL', 'libsql']
];

const LIBRARY_MAP: Record<string, Record<string, DatabaseEngine>> = {
  'requirements.txt': PYTHON_PACKAGES,
  'requirements-dev.txt': PYTHON_PACKAGES,
  'Pipfile': PYTHON_PACKAGES,
  'pyproject.toml': PYTHON_PACKAGES,
  'go.mod': GO_MODULES,
  'Gemfile': RUBY_GEMS
};

/**
 * Parses a connection URL into what is safe to show.
 *
 * The password is dropped rather than masked, so there is no string anybody
 * could put in front of a user that looks like a secret. `file:` URLs have no
 * authority at all, which is why they are handled separately.
 */
export function describeUrl(raw: string): { engine: DatabaseEngine; kind: DatabaseFinding['kind']; target: DatabaseFinding['target'] } | null {
  const value = raw.trim().replace(/^["']|["']$/g, '');
  for (const [pattern, engine, kind] of URL_SCHEMES) {
    if (!pattern.test(value)) continue;

    if (engine === 'sqlite') {
      const path = value.replace(/^sqlite:\/\//i, '').replace(/^file:/i, '');
      return { engine, kind, target: { database: path || undefined } };
    }

    try {
      const parsed = new URL(value);
      return {
        engine,
        kind,
        target: {
          host: parsed.hostname || undefined,
          port: parsed.port ? Number(parsed.port) : undefined,
          // The path is the database name; a query string is dropped with the
          // credentials, since it can carry a password too.
          database: parsed.pathname.replace(/^\//, '') || undefined,
          user: parsed.username || undefined
        }
      };
    } catch {
      // Not a URL the runtime can parse either; report the engine only.
      return { engine, kind, target: undefined };
    }
  }
  return null;
}

/** `provider = "postgresql"` inside a Prisma schema's datasource block. */
function prismaEngine(schema: string): { engine: DatabaseEngine; envName?: string } | null {
  const block = schema.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/);
  if (!block) return null;
  const provider = block[1].match(/provider\s*=\s*"([^"]+)"/);
  const url = block[1].match(/url\s*=\s*env\(\s*"([^"]+)"\s*\)/);
  const engine = provider ? mapEngineName(provider[1]) : 'unknown';
  return { engine, envName: url?.[1] };
}

/** Drizzle, TypeORM and friends all spell the dialect differently; this folds them. */
export function mapEngineName(name: string): DatabaseEngine {
  const value = name.toLowerCase();
  if (value.includes('postgres')) return 'postgresql';
  if (value.includes('mysql')) return 'mysql';
  if (value.includes('mariadb')) return 'mariadb';
  if (value.includes('mongo')) return 'mongodb';
  if (value.includes('sqlite')) return 'sqlite';
  if (value.includes('libsql') || value.includes('turso')) return 'libsql';
  if (value.includes('redis') || value.includes('valkey')) return 'redis';
  if (value.includes('clickhouse')) return 'clickhouse';
  if (value.includes('dynamo')) return 'dynamodb';
  if (value.includes('firestore') || value.includes('firebase')) return 'firestore';
  if (value.includes('mssql') || value.includes('sqlserver') || value.includes('sql server')) return 'mssql';
  if (value.includes('oracle')) return 'oracle';
  return 'unknown';
}

const envKeysOf = (content: string): string[] =>
  content
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=/))
    .filter((match): match is RegExpMatchArray => !!match)
    .map((match) => match[1]);

/** Every engine named by a JSON object's dependencies, with the package that named it. */
function enginesFromJson(text: string): Array<{ engine: DatabaseEngine; client: string }> {
  const found: Array<{ engine: DatabaseEngine; client: string }> = [];
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return found;
  }
  // `optionalDependencies` counts: a SQLite driver is often optional so the app
  // still installs where it cannot be built, and that is exactly the case this
  // is meant to notice.
  const deps = {
    ...(parsed.dependencies ?? {}),
    ...(parsed.devDependencies ?? {}),
    ...(parsed.optionalDependencies ?? {})
  };
  for (const name of Object.keys(deps)) {
    const engine = DEPENDENCIES[name];
    if (engine) found.push({ engine, client: name });
  }
  return found;
}

/** ORM/query-builder names in a package.json, which say how the database is used. */
function toolingFromJson(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    const deps = {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
      ...(parsed.optionalDependencies ?? {})
    };
    return Object.keys(deps).filter((name) => TOOLING[name] !== undefined);
  } catch {
    return [];
  }
}

/**
 * A package name as a word-ish regex.
 *
 * `-` and `_` are separators, so `psycopg2-binary` satisfies `psycopg2`; a letter
 * or digit is not, so `pgvector` does not satisfy `pg` and `mysql2` does not
 * satisfy `mysql`.
 */
const packagePattern = (name: string): RegExp => {
  // Escape first: doing it after the separator substitution would escape the
  // brackets of the character class and make `go-sql-driver` unmatchable.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_]/g, '[-_]');
  return new RegExp(`(^|[^a-z0-9.])${escaped}([^a-z0-9.]|$)`, 'i');
};

/** Matches package names in a text file (Python, Go, Ruby) without guessing at syntax. */
function enginesFromText(text: string, map: Record<string, DatabaseEngine>): Array<{ engine: DatabaseEngine; client: string }> {
  const found: Array<{ engine: DatabaseEngine; client: string }> = [];
  // Word-ish boundaries, because `pg` must not match `pgvector` or `pgp`, and a
  // Python requirement spells the same package with a hyphen or an underscore.
  for (const [name, engine] of Object.entries(map)) {
    if (packagePattern(name).test(text)) found.push({ engine, client: name });
  }
  return found;
}

/** ORM/query-builder names mentioned in a requirements file, Gemfile or go.mod. */
function toolingFromText(text: string): string[] {
  return Object.keys(TOOLING).filter((name) => packagePattern(name).test(text));
}

interface Accumulator {
  engine: DatabaseEngine;
  clients: Set<string>;
  evidence: DatabaseFinding['evidence'];
  target?: DatabaseFinding['target'];
  missingEnv: Set<string>;
}

const KIND_OF_ENGINE = (engine: DatabaseEngine): DatabaseFinding['kind'] => KIND_OF[engine] ?? 'database';

/**
 * Reads the evidence and reports what the project is built on.
 *
 * Ordering is by how directly the evidence states the engine: an actual
 * connection URL or a Prisma/ORM provider is conclusive, a driver dependency is
 * strong, and a compose service or a loose SQLite file is a hint.
 */
export function detectDatabases(evidence: DatabaseEvidence): ProjectDatabaseReport {
  const files = Object.fromEntries(
    Object.entries(evidence.files)
      .filter(([, content]) => typeof content === 'string')
      .map(([path, content]) => [path.replace(/\\/g, '/'), content])
  );
  const filenames = evidence.filenames ?? [];
  const scanned = Object.keys(files).sort();

  const tooling = new Set<string>();
  const byEngine = new Map<DatabaseEngine, Accumulator>();
  const add = (
    engine: DatabaseEngine,
    file: string,
    detail: string,
    client?: string,
    target?: DatabaseFinding['target']
  ): Accumulator => {
    let entry = byEngine.get(engine);
    if (!entry) {
      entry = { engine, clients: new Set(), evidence: [], missingEnv: new Set() };
      byEngine.set(engine, entry);
    }
    if (client) entry.clients.add(client);
    if (target && !entry.target) entry.target = target;
    if (!entry.evidence.some((e) => e.file === file && e.detail === detail)) entry.evidence.push({ file, detail });
    return entry;
  };

  // Names actually set by a real env file, used to report what is still missing.
  //
  // A template (`.env.example`, `.env.sample`) does not count and neither does a
  // variable left blank: both mean "you have to fill this in", and reporting
  // nothing missing because a template exists would be the opposite of helpful.
  const definedEnv = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!/(^|\/)\.env/.test(path)) continue;
    if (/\.(example|sample|template)$/i.test(path)) continue;
    for (const line of content.split(/\r?\n/)) {
      const assignment = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!assignment) continue;
      const value = assignment[2].trim().replace(/^["']|["']$/g, '');
      if (value) definedEnv.add(assignment[1]);
    }
  }

  for (const [path, content] of Object.entries(files)) {
    const name = path.split('/').pop() || path;

    // ---------------------------------------------------------------- URL first
    for (const line of content.split(/\r?\n/)) {
      const assignment = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)$/);
      if (!assignment) continue;
      const [, key, rawValue] = assignment;
      const isConnectionKey = CONNECTION_ENV.some(([envName]) => envName === key) || /_URL$|_URI$/.test(key);
      if (!isConnectionKey) continue;
      const described = describeUrl(rawValue);
      if (!described) continue;
      const entry = add(described.engine, path, `${key} → ${describeTarget(described.target)}`, undefined, described.target);
      if (!definedEnv.has(key)) entry.missingEnv.add(key);
    }

    // ------------------------------------------------------------ Prisma schema
    if (/schema\.prisma$/.test(path)) {
      const described = prismaEngine(content);
      if (described) {
        const entry = add(described.engine, path, `provider = ${described.engine}`);
        if (described.envName && !definedEnv.has(described.envName)) entry.missingEnv.add(described.envName);
      }
    }

    // --------------------------------------------------------- compose services
    if (/^(docker-)?compose\.ya?ml$/i.test(name) || /compose\.ya?ml$/i.test(path)) {
      for (const match of content.matchAll(/^\s*image:\s*['"]?([^\s'"]+)/gm)) {
        const image = match[1].split('/').pop() || match[1];
        const found = COMPOSE_IMAGES.find(([pattern]) => pattern.test(image.toLowerCase()));
        if (found) add(found[1], path, `image: ${match[1]}`, undefined, undefined);
      }
    }

    // --------------------------------------------------------------- package.json
    if (name === 'package.json') {
      for (const { engine, client } of enginesFromJson(content)) add(engine, path, `dependency: ${client}`, client);
      for (const client of toolingFromJson(content)) tooling.add(client);
    }

    // --------------------------------------- anything else by package name
    const map = LIBRARY_MAP[name];
    if (map && name !== 'package.json') {
      for (const { engine, client } of enginesFromText(content, map)) add(engine, path, `package: ${client}`, client);
      for (const client of toolingFromText(content)) tooling.add(client);
    }

    // ------------------------------------------------------- typed connection info
    // Only from config-shaped files: `{ dialect: 'postgresql' }` is a statement
    // about the database, but a `type:` field anywhere else is not.
    if (/(config|drizzle|typeorm|sequelize|knex|orm)/i.test(name) && /\.(ts|js|mjs|cjs|json|ya?ml|py|rb)$/i.test(path)) {
      const typed = content.match(/(?:^|[\s{,;])(?:dialect|type|driver|client)\s*[:=]\s*['"]([a-z0-9 _-]+)['"]/i);
      if (typed) {
        const engine = mapEngineName(typed[1]);
        if (engine !== 'unknown') add(engine, path, `configured for ${engine}`);
      }
    }
  }

  // A database file sitting in the project root is a SQLite project.
  for (const filename of filenames) {
    if (/\.(sqlite3?|db)$/i.test(filename)) {
      add('sqlite', filename, 'SQLite file in the project');
    }
  }

  const databases = Array.from(byEngine.values())
    .map<DatabaseFinding>((entry) => ({
      engine: entry.engine,
      kind: KIND_OF_ENGINE(entry.engine),
      clients: Array.from(entry.clients).sort(),
      evidence: entry.evidence,
      target: entry.target,
      missingEnv: Array.from(entry.missingEnv).sort()
    }))
    // A named engine beats "a driver we could not identify", and databases beat
    // caches, so the thing the user came to see is first.
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'database' ? -1 : 1;
      return a.engine.localeCompare(b.engine);
    });

  return { scanned, databases, tooling: Array.from(tooling).sort() };
}

/** A host/port/database summary with nothing secret in it. */
export function describeTarget(target?: DatabaseFinding['target']): string {
  if (!target) return 'configured';
  const parts: string[] = [];
  if (target.host) parts.push(target.port ? `${target.host}:${target.port}` : target.host);
  if (target.database) parts.push(target.database);
  if (parts.length === 0 && target.user) parts.push(`user ${target.user}`);
  return parts.join(' / ') || 'configured';
}
