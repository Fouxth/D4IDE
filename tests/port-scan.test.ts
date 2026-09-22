import { describe, expect, it } from 'vitest';
import net from 'net';
import {
  devPorts,
  portAvailable,
  keepDevListeners,
  parseLsof,
  parseNetstat,
  parseProcessCsv,
  mentionsProject,
  parseProcessCommands,
  parsePs,
  parseTasklist,
  portsForProject,
  rankListeningPorts
} from '../src/main/preview/port-scan';

/**
 * Preview port discovery.
 *
 * The preview has to attach to whatever port the project really serves on, and
 * for a server D4IDE did not start the only honest source is the operating
 * system's own listener table. These tests pin the parsing against output taken
 * from a real Windows `netstat -ano` and a real `lsof`/`ps`, because the shapes
 * differ enough between platforms that a regex that "looks right" is not.
 */

const NETSTAT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1052',
  '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       21016',
  '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       21016',
  '  TCP    [::]:5173              [::]:0                 LISTENING       21016',
  '  TCP    127.0.0.1:11434        0.0.0.0:0              LISTENING       8842',
  '  TCP    127.0.0.1:56789        0.0.0.0:0              LISTENING       4410',
  '  TCP    127.0.0.1:50123        127.0.0.1:5173         ESTABLISHED     21016',
  ''
].join('\r\n');

const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"node.exe","21016","Console","1","412,344 K"',
  '"ollama.exe","8842","Console","1","88,000 K"',
  '"acme-helper.exe","4410","Console","1","12,000 K"'
].join('\r\n');

const LSOF = [
  'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
  'node     4410 tou   23u  IPv4 0x1a2b3c4d      0t0  TCP *:4000 (LISTEN)',
  'postgres 7788 tou    7u  IPv6 0x2b3c4d5e      0t0  TCP *:5432 (LISTEN)',
  'node     4410 tou   24u  IPv4 0x3c4d5e6f      0t0  TCP 127.0.0.1:4000 (LISTEN)'
].join('\n');

describe('netstat parsing', () => {
  it('keeps listening sockets only, with their port and owning pid', () => {
    const listeners = parseNetstat(NETSTAT);
    expect(listeners).toContainEqual({ port: 5173, pid: 21016 });
    expect(listeners).toContainEqual({ port: 11434, pid: 8842 });
    // An established connection is not a server.
    expect(listeners.some((entry) => entry.port === 50123)).toBe(false);
  });

  it('reads IPv6 listeners as the same port', () => {
    const ports = parseNetstat(NETSTAT).filter((entry) => entry.port === 5173);
    expect(ports).toHaveLength(3);
    expect(new Set(ports.map((entry) => entry.pid))).toEqual(new Set([21016]));
  });

  it('returns nothing for output that is not a netstat table', () => {
    expect(parseNetstat('')).toEqual([]);
    expect(parseNetstat('netstat: command not found')).toEqual([]);
  });
});

describe('process table parsing', () => {
  it('maps pid to executable name from tasklist csv', () => {
    const names = parseTasklist(TASKLIST);
    expect(names.get(21016)).toBe('node.exe');
    expect(names.get(8842)).toBe('ollama.exe');
  });

  it('maps pid to command name from ps', () => {
    const names = parsePs('  1 init\n 4410 node\n 7788 postgres\n');
    expect(names.get(4410)).toBe('node');
    expect(names.get(7788)).toBe('postgres');
  });
});

describe('choosing the ports worth showing', () => {
  it('keeps a dev runtime on a project port and drops a privileged or foreign one', () => {
    const ports = devPorts(parseNetstat(NETSTAT), parseTasklist(TASKLIST));
    // The Vite server: node, on a project port.
    expect(ports).toContain(5173);
    // Something else's service: a listener, but not the user's app.
    expect(ports).not.toContain(11434);
    // Neither a privileged port nor an arbitrary helper process.
    expect(ports).not.toContain(135);
    expect(ports).not.toContain(56789);
  });

  it('keeps every in-range port when the process table could not be read', () => {
    // `tasklist` refusing to answer is not evidence that the server on 56789 is
    // not the user's app — the owner is simply unknown, so nothing is dropped.
    const ports = devPorts(parseNetstat(NETSTAT), new Map());
    expect(ports).toEqual([5173, 11434, 56789]);
  });

  it('handles posix output', () => {
    const ports = devPorts(parseLsof(LSOF), parsePs(' 4410 node\n 7788 postgres\n'));
    expect(ports).toEqual([4000]);
  });

  it('never reports a port a browser could not open', () => {
    const ports = devPorts(parseNetstat(NETSTAT), parseTasklist(TASKLIST));
    expect(ports.every((port) => port > 1024 && port < 65536)).toBe(true);
  });
});
describe('choosing between several running servers', () => {
  const listeners = [
    { port: 1708, pid: 111 },
    { port: 41873, pid: 222 }
  ];

  const table = (entries: [number, { command: string; startedAt: number }][]) => new Map(entries);

  it('reads pid, start time and command line from the PowerShell csv', () => {
    const csv = [
      '"ProcessId","Started","CommandLine"',
      '"111","2026-09-18T18:29:40.0000000Z","""node.exe"" dist/server.bundle.js"',
      '"222","2026-09-19T03:22:06.0000000Z","""node.exe"" dev-server.cjs"'
    ].join('\r\n');
    const parsed = parseProcessCsv(csv);
    expect(parsed.get(222)?.command).toContain('dev-server.cjs');
    expect(parsed.get(222)?.startedAt).toBe(Date.parse('2026-09-19T03:22:06.0000000Z'));
    expect(parsed.get(111)?.startedAt).toBeLessThan(parsed.get(222)!.startedAt);
  });

  it('reads elapsed time back into a start time from ps', () => {
    const now = Date.parse('2026-09-19T10:00:00Z');
    const parsed = parseProcessCommands('  111 01:00:00 node /srv/other.js\n  222 0:10 node dev-server.cjs\n', now);
    expect(parsed.get(111)?.startedAt).toBe(now - 60 * 60 * 1000);
    expect(parsed.get(222)?.startedAt).toBe(now - 10 * 1000);
    expect(parsed.get(222)?.command).toBe('node dev-server.cjs');
  });

  it('recognises the project in an absolute path and in a relative one', () => {
    const project = 'F:\\D4IDE\\probe-project';
    expect(mentionsProject('node F:\\D4IDE\\probe-project\\dev-server.cjs', project)).toBe(true);
    // Started from inside the project, so the path on the command line is relative.
    expect(mentionsProject('node .freebuff/probe-project/dev-server.cjs 41873', project)).toBe(true);
    // A neighbouring project with a similar name is not this project.
    expect(mentionsProject('node F:\\D4IDE\\probe-project-old\\index.js', project)).toBe(false);
  });

  it('puts the process started in this project ahead of every other server', () => {
    const commands = table([
      [111, { command: 'node.exe C:\\other-project\\vite.js --port 1708', startedAt: Date.now() }],
      [222, { command: 'node.exe .freebuff/probe-project/dev-server.cjs 41873', startedAt: 1 }]
    ]);
    // Even though the other server started later, it is not this project's.
    expect(rankListeningPorts(listeners, commands, 'F:\\D4IDE\\probe-project')[0]).toBe(41873);
  });

  it('prefers the newest development server when neither belongs to the project', () => {
    const commands = table([
      [111, { command: 'node.exe dist/server.bundle.js', startedAt: 1000 }],
      [222, { command: 'node.exe node_modules/vite/bin/vite.js', startedAt: 9000 }]
    ]);
    expect(rankListeningPorts(listeners, commands, 'F:\\elsewhere')[0]).toBe(41873);
  });

  it('falls back to the port order when the process table is empty', () => {
    expect(rankListeningPorts(listeners, new Map(), 'F:\\D4IDE')).toEqual([1708, 41873]);
  });

  it('keeps the pid its port was found on', () => {
    const kept = keepDevListeners(parseNetstat(NETSTAT), parseTasklist(TASKLIST));
    expect(kept).toContainEqual({ port: 5173, pid: 21016 });
    expect(kept.some((entry) => entry.port === 11434)).toBe(false);
  });

  /**
   * Whose server is it?
   *
   * The panel belongs to the folder that is open, so a listener whose process
   * was started somewhere else is not a candidate for it — that is how a project
   * serving on 1001 ended up sharing a panel with another project on 5173.
   */
  describe('ports that belong to the open project', () => {
    const listeners = [
      { port: 1001, pid: 111 },
      { port: 5173, pid: 222 },
      { port: 4321, pid: 333 }
    ];
    const commands = new Map([
      [111, { command: 'node.exe F:\\alpha\\dev-server.cjs', startedAt: 1 }],
      [222, { command: 'node.exe F:\\beta\\node_modules\\vite\\bin\\vite.js', startedAt: 2 }]
      // 333 is missing outright: the OS would not say what it is.
    ]);

    it('keeps this project’s server and drops the neighbour’s', () => {
      const mine = portsForProject(listeners, commands, 'F:\\alpha');
      expect(mine).toEqual([
        { port: 1001, pid: 111 },
        // An unreadable command line is not evidence that the server on 4321
        // belongs to somebody else.
        { port: 4321, pid: 333 }
      ]);
    });

    it('claims nothing at all without a project', () => {
      expect(portsForProject(listeners, commands, '')).toEqual([]);
      expect(portsForProject(listeners, commands, null)).toEqual([]);
    });
  });
});

/**
 * The cheap question the port allocator asks while somebody is typing.
 *
 * Reading the whole listener table costs about half a second on Windows, which
 * cannot sit between a keystroke and a command. One port is answered by trying
 * to connect to it — so this is tested against a real socket rather than a
 * fixture, because "nobody is listening" is a property of the operating system
 * and not of any output we could fake.
 */
describe('asking about one port', () => {
  it('says a listening port is taken and a closed one is free', async () => {
    const server = net.createServer();
    const port = await new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
    );
    expect(await portAvailable(port)).toBe(false);
    await new Promise((resolve) => server.close(resolve));
    expect(await portAvailable(port)).toBe(true);
  });
});
