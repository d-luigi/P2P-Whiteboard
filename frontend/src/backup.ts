import { boardId } from './board';
import { exportBackup, importBackup } from './docStore';

/** Save the whole board to a file (`.p2pwb`). Import it on any board, even another device. */
export function downloadBackup() {
  const bytes = exportBackup();
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `whiteboard-${boardId.slice(0, 6)}-${new Date().toISOString().slice(0, 10)}.p2pwb`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/** Merge a backup file into this board. Resolves with the number of shapes it held. */
export async function importBackupFile(file: File): Promise<number> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('That file is too large to be a whiteboard backup.');
  return importBackup(new Uint8Array(await file.arrayBuffer()));
}

/** Copy text; where the clipboard is unavailable (e.g. plain http) show it to copy by hand. */
export async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt(`Copy ${what}:`, text);
    return false;
  }
}
