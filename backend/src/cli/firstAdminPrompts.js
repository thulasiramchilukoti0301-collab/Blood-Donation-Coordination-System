import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { FirstAdminError } from '../modules/auth/firstAdmin.js';

export function createFirstAdminPrompts({ input, output, signal, cancel }) {
  // Suppress ALL readline echo, including email/typeahead, so a multiline paste
  // can never reveal a password while switching between questions. No history.
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  silent.isTTY = true;
  silent.columns = output.columns || 80;
  const terminal = createInterface({ input, output: silent, terminal: true, historySize: 0 });
  let closing = false;
  terminal.on('SIGINT', cancel);
  terminal.on('close', () => { if (!closing) cancel(); });
  return {
    async ask(label) {
      if (signal.aborted) throw new FirstAdminError('BOOTSTRAP_CANCELLED');
      output.write(label);
      try { return await terminal.question('', { signal }); }
      catch { throw new FirstAdminError('BOOTSTRAP_CANCELLED'); }
      finally { output.write('\n'); }
    },
    close() {
      closing = true;
      terminal.close(); // Restores the input terminal's raw mode.
      silent.destroy();
    },
  };
}
