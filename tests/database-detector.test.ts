import { describe, expect, it } from 'vitest';
import { describeTarget, describeUrl, detectDatabases } from '../src/main/project/database-detector';

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

describe('describeUrl', () => {
  it('reports the engine and the target, and never the credentials', () => {
    const found = describeUrl('postgres://admin:s3cr3t@db.internal:5433/realestate?sslmode=require');
    expect(found).toEqual({
      engine: 'postgresql',
      kind: 'database',
      target: { host: 'db.internal', port: 5433, database: 'realestate', user: 'admin' }
    });
    // Nothing anywhere in the result may contain the password.
    expect(JSON.stringify(found)).not.toContain('s3cr3t');
  });

  it('recognises the schemes that matter and calls Redis a cache', () => {
    expect(describeUrl('mysql://app@localhost/app')?.engine).toBe('mysql');
    expect(describeUrl('mongodb+srv://cluster.example.net/shop')?.engine).toBe('mongodb');
    expect(describeUrl('redis://localhost:6379')?.kind).toBe('cache');
    expect(describeUrl('file:./data/app.sqlite')?.engine).toBe('sqlite');
    expect(describeUrl('libsql://my-db.turso.io')?.engine).toBe('libsql');
    expect(describeUrl('https://example.com')).toBeNull();
  });

  it('survives a URL that is not parseable', () => {
    expect(describeUrl('postgres://not a url')).toMatchObject({ engine: 'postgresql' });
  });
});

describe('describeTarget', () => {
  it('summarises without a user or password when there is no host', () => {
    expect(describeTarget({ user: 'admin' })).toBe('user admin');
    expect(describeTarget(undefined)).toBe('configured');
    expect(describeTarget({ host: 'localhost', database: 'shop' })).toBe('localhost / shop');
  });
});

describe('detectDatabases', () => {
  it('finds PostgreSQL from a Prisma schema and reports the env var it still needs', () => {
    const report = detectDatabases({
      files: {
        'prisma/schema.prisma': `
          datasource db {
            provider = "postgresql"
            url      = env("DATABASE_URL")
          }
        `,
        'package.json': pkg({ '@prisma/client': '^6.0.0', express: '^4' }),
        '.env.example': 'DATABASE_URL=\n'
      },
      filenames: ['package.json', 'prisma']
    });

    expect(report.databases).toHaveLength(1);
    const [pg] = report.databases;
    expect(pg.engine).toBe('postgresql');
    expect(pg.kind).toBe('database');
    expect(pg.evidence.map((e) => e.file)).toEqual(['prisma/schema.prisma']);
    expect(pg.missingEnv).toEqual(['DATABASE_URL']);
    expect(report.scanned).toContain('prisma/schema.prisma');
    // An ORM says how the database is used, not which database it is, so it is
    // named at the report level instead of being attributed to an engine here.
    expect(report.tooling).toContain('@prisma/client');
    expect(pg.clients).toEqual([]);
  });

  it('knows a defined env var is not missing', () => {
    const report = detectDatabases({
      files: {
        '.env': 'DATABASE_URL=postgres://app:secret@localhost:5432/shop\n',
        'package.json': pkg({ pg: '^8.0.0' })
      },
      filenames: []
    });
    const pg = report.databases.find((db) => db.engine === 'postgresql')!;
    expect(pg.missingEnv).toEqual([]);
    expect(pg.target).toMatchObject({ host: 'localhost', port: 5432, database: 'shop' });
  });

  it('reads a compose file for services the code has not touched yet', () => {
    const report = detectDatabases({
      files: {
        'docker-compose.yml': `
          services:
            db:
              image: postgres:16-alpine
            cache:
              image: redis:7
        `
      },
      filenames: ['docker-compose.yml']
    });
    expect(report.databases.map((db) => db.engine)).toEqual(['postgresql', 'redis']);
    expect(report.databases.find((db) => db.engine === 'redis')?.kind).toBe('cache');
  });

  it('reads the language ecosystems that are not JavaScript', () => {
    const django = detectDatabases({
      files: { 'requirements.txt': 'Django==5.0\npsycopg2-binary==2.9\nredis==5.0\n' },
      filenames: []
    });
    expect(django.databases.map((db) => db.engine)).toEqual(['postgresql', 'redis']);
    // Django is an ORM, not an engine: it is named as tooling, not guessed at.
    expect(django.tooling).toContain('Django'.toLowerCase());

    const go = detectDatabases({
      files: { 'go.mod': 'require (\n\tgithub.com/go-sql-driver/mysql v1.8.0\n)\n' },
      filenames: []
    });
    expect(go.databases[0].engine).toBe('mysql');

    const ruby = detectDatabases({ files: { Gemfile: "gem 'pg', '~> 1.5'\n" }, filenames: [] });
    expect(ruby.databases[0].engine).toBe('postgresql');
  });

  it('notices a SQLite file sitting in the project and reads a drizzle dialect', () => {
    const report = detectDatabases({
      files: { 'drizzle.config.ts': "export default { dialect: 'sqlite', schema: './db/schema.ts' };\n" },
      filenames: ['app.db', 'package.json']
    });
    const sqlite = report.databases.filter((db) => db.engine === 'sqlite');
    expect(sqlite).toHaveLength(1);
    expect(sqlite[0].evidence.map((e) => e.file).sort()).toEqual(['app.db', 'drizzle.config.ts']);
  });

  it('does not match a package name inside a longer one', () => {
    const report = detectDatabases({ files: { 'package.json': pkg({ pgvector: '^0.2.0' }) }, filenames: [] });
    expect(report.databases).toEqual([]);

    const go = detectDatabases({ files: { 'go.mod': 'require github.com/jackc/pgxstuff v1.0.0\n' }, filenames: [] });
    expect(go.databases).toEqual([]);
  });

  it('says it found nothing rather than defaulting to something', () => {
    const report = detectDatabases({
      files: { 'package.json': pkg({ react: '^18', express: '^4' }), 'README.md': 'hi' },
      filenames: ['package.json', 'README.md']
    });
    expect(report.databases).toEqual([]);
    expect(report.tooling).toEqual([]);
    expect(report.scanned).toEqual(['README.md', 'package.json']);
  });

  it('lists a real database before a cache', () => {
    const report = detectDatabases({
      files: { 'package.json': pkg({ ioredis: '^5', pg: '^8' }) },
      filenames: []
    });
    expect(report.databases.map((db) => `${db.kind}:${db.engine}`)).toEqual(['database:postgresql', 'cache:redis']);
  });
});
