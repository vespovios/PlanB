// Administration: accounts, agent tokens, backup/restore of database + assets together.
// Usage: npm run user -- <command> [options]   (production: node dist/server/cli.js <command>)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import Database from 'better-sqlite3';
import { Auth } from './auth.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { APP_VERSION } from './version.js';

const config = loadConfig();
const [command, ...rest] = process.argv.slice(2);
const args: Record<string, string | true> = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else args[key] = true;
  }
}
const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);

function usage(): never {
  console.log(`PlanB admin

  user:add --email you@example.com --name "Your Name" [--password-stdin]
  user:list
  user:password --email you@example.com [--password-stdin]
  user:email --email old@example.com --new-email new@example.com   change the sign-in e-mail
  user:name --email you@example.com --name "Your Name"             change the name shown in PlanB
  share:add --owner you@example.com --with them@example.com          they can see and edit all your episodes
  share:remove --owner you@example.com --with them@example.com
  share:list
  token:create --email you@example.com --label "Claude"      prints a new agent token once
  backup --out backups/planb-YYYYMMDD.tar.gz                  online backup of database + assets
  restore --from backups/file.tar.gz [--yes]                  stop the app first
  verify                                                      check every asset row has its file
  purge-deleted [--days 30]                                   permanently remove soft-deleted episodes

Data directory: ${config.dataDir} (PLANB_DATA_DIR)`);
  process.exit(command ? 1 : 0);
}

async function readPassword(prompt: string): Promise<string> {
  if (args['password-stdin']) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => {
    if (!muted) process.stdout.write(s);
  };
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

function assetProblems(dbFile: string, assetsDir: string): string[] {
  const db = new Database(dbFile, { readonly: true });
  const rows = db.prepare('SELECT id, file FROM assets').all() as { id: string; file: string }[];
  db.close();
  return rows.filter((r) => !fs.existsSync(path.join(assetsDir, r.file))).map((r) => `missing file for asset ${r.id}: ${r.file}`);
}

async function main() {
  switch (command) {
    case 'user:add': {
      const email = str('email') ?? usage();
      const name = str('name') ?? usage();
      const auth = new Auth(openDatabase(config.dataDir), config.sessionDays);
      const password = await readPassword('Password (min 10 characters): ');
      const user = await auth.createUser(email, name, password);
      console.log(`Created ${user.name} <${user.email}> (${user.id})`);
      break;
    }
    case 'user:list': {
      const auth = new Auth(openDatabase(config.dataDir), config.sessionDays);
      for (const u of auth.listUsers()) console.log(`${u.id}  ${u.email}  ${u.name}  ${u.created_at}`);
      break;
    }
    case 'user:password': {
      const auth = new Auth(openDatabase(config.dataDir), config.sessionDays);
      const user = auth.findUserByEmail(str('email') ?? usage());
      if (!user) throw new Error('No such user');
      await auth.setPassword(user.id, await readPassword('New password (min 10 characters): '));
      console.log('Password changed; existing browser sessions were signed out.');
      break;
    }
    case 'user:email': {
      const auth = new Auth(openDatabase(config.dataDir), config.sessionDays);
      const user = auth.findUserByEmail(str('email') ?? usage());
      if (!user) throw new Error('No such user');
      const email = auth.setEmail(user.id, str('new-email') ?? usage());
      console.log(`${user.name} now signs in as ${email}.`);
      break;
    }
    case 'user:name': {
      const auth = new Auth(openDatabase(config.dataDir), config.sessionDays);
      const user = auth.findUserByEmail(str('email') ?? usage());
      if (!user) throw new Error('No such user');
      auth.setName(user.id, str('name') ?? usage());
      console.log(`Name changed to ${str('name')!.trim()}.`);
      break;
    }
    case 'share:add':
    case 'share:remove': {
      const auth = new Auth(openDatabase(config.dataDir), config.sessionDays);
      const owner = auth.findUserByEmail(str('owner') ?? usage());
      const member = auth.findUserByEmail(str('with') ?? usage());
      if (!owner || !member) throw new Error('No such user');
      if (command === 'share:add') {
        auth.share(owner.id, member.id);
        console.log(`${member.name} can now see and edit all of ${owner.name}'s episodes.`);
      } else {
        console.log(auth.unshare(owner.id, member.id) ? `${member.name} no longer sees ${owner.name}'s episodes.` : 'Nothing was shared.');
      }
      break;
    }
    case 'share:list': {
      const auth = new Auth(openDatabase(config.dataDir), config.sessionDays);
      for (const s of auth.listShares()) console.log(`${s.owner} → ${s.member}  ${s.created_at}`);
      break;
    }
    case 'token:create': {
      const auth = new Auth(openDatabase(config.dataDir), config.sessionDays);
      const user = auth.findUserByEmail(str('email') ?? usage());
      if (!user) throw new Error('No such user');
      const t = auth.createAgentToken(user.id, str('label') ?? 'Agent');
      console.log(t.token);
      break;
    }
    case 'backup': {
      const out = path.resolve(str('out') ?? `backups/planb-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`);
      const dbFile = path.join(config.dataDir, 'planb.db');
      if (!fs.existsSync(dbFile)) throw new Error(`No database at ${dbFile}`);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'planb-backup-'));
      try {
        // 1. Consistent online copy of the database. 2. Assets are immutable and written before the
        // rows that reference them, so copying afterwards includes every file the copy refers to.
        const live = new Database(dbFile, { readonly: true });
        await live.backup(path.join(tmp, 'planb.db'));
        const userVersion = live.pragma('user_version', { simple: true });
        live.close();
        const assetsDir = path.join(config.dataDir, 'assets');
        if (fs.existsSync(assetsDir)) fs.cpSync(assetsDir, path.join(tmp, 'assets'), { recursive: true });
        else fs.mkdirSync(path.join(tmp, 'assets'));
        const problems = assetProblems(path.join(tmp, 'planb.db'), path.join(tmp, 'assets'));
        if (problems.length) throw new Error(`Backup is incomplete:\n${problems.join('\n')}`);
        fs.writeFileSync(
          path.join(tmp, 'manifest.json'),
          JSON.stringify({ app: 'PlanB', version: APP_VERSION, schemaVersion: userVersion, createdAt: new Date().toISOString() }, null, 2),
        );
        fs.mkdirSync(path.dirname(out), { recursive: true });
        execFileSync('tar', ['-czf', out, '-C', tmp, 'manifest.json', 'planb.db', 'assets']);
        console.log(`Backup written to ${out}`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      break;
    }
    case 'restore': {
      const from = path.resolve(str('from') ?? usage());
      if (!args.yes) {
        console.log(`This replaces the database and assets in ${config.dataDir} with ${from}.
Stop the PlanB server first. The current data is kept in ${config.dataDir}/pre-restore-<time>/.
Re-run with --yes to continue.`);
        process.exit(1);
      }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'planb-restore-'));
      try {
        execFileSync('tar', ['-xzf', from, '-C', tmp]);
        if (!fs.existsSync(path.join(tmp, 'planb.db'))) throw new Error('Archive does not contain planb.db');
        const check = new Database(path.join(tmp, 'planb.db'), { readonly: true });
        const integrity = check.pragma('integrity_check', { simple: true });
        check.close();
        if (integrity !== 'ok') throw new Error(`Database integrity check failed: ${integrity}`);
        const problems = assetProblems(path.join(tmp, 'planb.db'), path.join(tmp, 'assets'));
        if (problems.length) throw new Error(`Backup is missing assets:\n${problems.join('\n')}`);

        fs.mkdirSync(config.dataDir, { recursive: true });
        const keep = path.join(config.dataDir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
        fs.mkdirSync(keep);
        for (const name of ['planb.db', 'planb.db-wal', 'planb.db-shm', 'assets', 'cache']) {
          const p = path.join(config.dataDir, name);
          if (fs.existsSync(p)) fs.renameSync(p, path.join(keep, name));
        }
        fs.cpSync(path.join(tmp, 'planb.db'), path.join(config.dataDir, 'planb.db'));
        fs.cpSync(path.join(tmp, 'assets'), path.join(config.dataDir, 'assets'), { recursive: true });
        openDatabase(config.dataDir).close(); // applies any newer migrations
        console.log(`Restored ${from}. Previous data moved to ${keep}.`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      break;
    }
    case 'verify': {
      const problems = assetProblems(path.join(config.dataDir, 'planb.db'), path.join(config.dataDir, 'assets'));
      if (problems.length) {
        console.error(problems.join('\n'));
        process.exit(1);
      }
      console.log('All asset files present.');
      break;
    }
    case 'purge-deleted': {
      const days = Number(str('days') ?? 30);
      const db = openDatabase(config.dataDir);
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      const eps = db.prepare('SELECT id FROM episodes WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as { id: string }[];
      for (const { id } of eps) {
        db.prepare('DELETE FROM episodes WHERE id = ?').run(id); // cascades to revisions and asset rows
        fs.rmSync(path.join(config.dataDir, 'assets', id), { recursive: true, force: true });
      }
      console.log(`Purged ${eps.length} episode(s) deleted more than ${days} days ago.`);
      break;
    }
    default:
      usage();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
