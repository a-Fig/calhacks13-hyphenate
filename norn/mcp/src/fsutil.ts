// Private directories for identity tokens and minted credentials.
//
// POSIX: the directory is mode 0700 and files are written 0600. Windows ignores those modes, and a
// directory under the repo inherits `BUILTIN\Users: Modify` from its parent, so there the
// inheritance is removed and only the current user is granted access (icacls). Only the directory
// passed in (and what is already in it) is touched; nothing above it.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';

export function securePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const me = execFileSync('whoami', { encoding: 'utf8', windowsHide: true }).trim();
    // Grant first, then cut the inheritance, each on the directory alone: Windows carries both down to
    // what is already inside. (Doing both in one recursive call left existing files with an empty ACL,
    // which nobody, the owner included, can open.)
    execFileSync('icacls', [dir, '/grant:r', `${me}:(OI)(CI)F`], { stdio: 'ignore', windowsHide: true });
    execFileSync('icacls', [dir, '/inheritance:r'], { stdio: 'ignore', windowsHide: true });
  } else {
    chmodSync(dir, 0o700);
  }
}

/** Windows: the access control list of a path as text (for tests). */
export function windowsAcl(path: string): string {
  return execFileSync('icacls', [path], { encoding: 'utf8', windowsHide: true });
}
