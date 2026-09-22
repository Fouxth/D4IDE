import { describe, expect, it } from 'vitest';
import {
  checkProjectScope,
  deletesProjectRoot,
  isRecursiveDelete,
  writesOutsideProject
} from '../src/main/security/scope-guard';

/**
 * "ห้ามออกนอกลู่" and "ห้ามลบโปรเจกต์ทั้งหมดถ้าไม่ได้สั่ง", as code.
 *
 * These are the checks that decide *before* anything runs, so a wrong verdict
 * here is either a project that disappears or an agent that cannot work. Both
 * directions are pinned: what must be refused, and what must stay allowed.
 */
const PROJECT = process.platform === 'win32' ? 'F:\\HuayD' : '/work/HuayD';

describe('checkProjectScope', () => {
  it('accepts a path inside the project, in either spelling', () => {
    expect(checkProjectScope(PROJECT, 'src/app.ts').inside).toBe(true);
    expect(checkProjectScope(PROJECT, './src/../src/app.ts').inside).toBe(true);
    expect(checkProjectScope(PROJECT, PROJECT).inside).toBe(true);
  });

  it('refuses a path that climbs out, or lands in another project', () => {
    expect(checkProjectScope(PROJECT, '../other-project/secret.ts').inside).toBe(false);
    expect(checkProjectScope(PROJECT, '..').inside).toBe(false);
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
    expect(checkProjectScope(PROJECT, outside).inside).toBe(false);
  });

  it('sees the difference between the project and the folder above it', () => {
    const root = checkProjectScope(PROJECT, PROJECT);
    expect(root.inside).toBe(true);
    expect(root.isRootOrAbove).toBe(false);

    const above = checkProjectScope(PROJECT, process.platform === 'win32' ? 'F:\\' : '/work');
    expect(above.inside).toBe(false);
    expect(above.isRootOrAbove).toBe(true);
  });

  it('treats a missing project as "cannot judge" rather than blocking everything', () => {
    expect(checkProjectScope(null, 'anything.txt').inside).toBe(true);
  });
});

describe('deletesProjectRoot', () => {
  it('catches the ways a project actually disappears in one call', () => {
    expect(deletesProjectRoot('rm -rf .', PROJECT)).toBe(true);
    expect(deletesProjectRoot('rm -rf *', PROJECT)).toBe(true);
    expect(deletesProjectRoot('rm -rf ./', PROJECT)).toBe(true);
    expect(deletesProjectRoot('git clean -xfd', PROJECT)).toBe(true);
    expect(deletesProjectRoot('git clean -fd', PROJECT)).toBe(true);
    expect(deletesProjectRoot('rmdir /s /q F:\\HuayD', PROJECT)).toBe(true);
    expect(deletesProjectRoot('rd /s /q "F:\\HuayD"', PROJECT)).toBe(true);
    expect(deletesProjectRoot('Remove-Item -Recurse -Force F:\\HuayD', PROJECT)).toBe(true);
  });

  it('catches the folder that contains the project', () => {
    expect(deletesProjectRoot('rm -rf ..', PROJECT)).toBe(true);
    expect(deletesProjectRoot('rm -rf F:\\', PROJECT)).toBe(true);
    if (process.platform !== 'win32') expect(deletesProjectRoot('rm -rf /work', PROJECT)).toBe(true);
  });

  it('leaves ordinary deletes inside the project alone', () => {
    expect(deletesProjectRoot('rm -rf node_modules', PROJECT)).toBe(false);
    expect(deletesProjectRoot('rm -rf dist build', PROJECT)).toBe(false);
    expect(deletesProjectRoot('rm src/old-file.ts', PROJECT)).toBe(false);
    expect(deletesProjectRoot('npm run clean', PROJECT)).toBe(false);
    expect(deletesProjectRoot('git status', PROJECT)).toBe(false);
  });
});

describe('isRecursiveDelete', () => {
  it('recognises a batch delete in either shell', () => {
    expect(isRecursiveDelete('rm -rf dist')).toBe(true);
    expect(isRecursiveDelete('rd /s /q build')).toBe(true);
    expect(isRecursiveDelete('Remove-Item -Recurse .cache')).toBe(true);
    expect(isRecursiveDelete('git clean -fd')).toBe(true);
  });

  it('does not flag a single file or a read', () => {
    expect(isRecursiveDelete('rm old.log')).toBe(false);
    expect(isRecursiveDelete('del old.log')).toBe(false);
    expect(isRecursiveDelete('ls -la')).toBe(false);
  });
});

describe('writesOutsideProject', () => {
  it('catches a write aimed outside the folder the run was given', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\hosts' : '/etc/hosts';
    expect(writesOutsideProject(`echo hi > ${outside}`, PROJECT)).toBe(outside);
    expect(writesOutsideProject(`remove-item ${outside}`, PROJECT)).toBe(outside);
    expect(writesOutsideProject(`robocopy src ${process.platform === 'win32' ? 'D:\\backup' : '/opt/backup'}`, PROJECT)).toMatch(/backup/);
  });

  it('lets a project read and write inside itself', () => {
    expect(writesOutsideProject('npm run build', PROJECT)).toBe(null);
    expect(writesOutsideProject('echo hi > dist/out.txt', PROJECT)).toBe(null);
    expect(writesOutsideProject('rm -rf node_modules', PROJECT)).toBe(null);
    // Reads of a toolchain file outside the project are not writes.
    expect(writesOutsideProject(process.platform === 'win32' ? 'type C:\\Windows\\win.ini' : 'cat /etc/hosts', PROJECT)).toBe(null);
  });
});
