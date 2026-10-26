// Split checked-in Workbench scripts containing DELIMITER directives. This is
// not an SQL parser for untrusted/user input and does not execute anything.
export function mysqlStatements(source) {
  if (typeof source !== 'string') throw new TypeError('SQL source must be text.');
  const statements = [];
  let delimiter = ';';
  let buffer = '';
  const hasSql = (text) => text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/--[^\r\n]*/gu, '').trim().length > 0;
  for (const line of source.split(/\r?\n/u)) {
    const directive = /^\s*DELIMITER\s+(\S+)\s*$/iu.exec(line);
    if (directive) {
      if (hasSql(buffer)) throw new Error('Delimiter changed before a statement ended.');
      buffer = ''; delimiter = directive[1]; continue;
    }
    buffer += line + '\n';
    if (line.trimEnd().endsWith(delimiter)) {
      const statement = buffer.slice(0, buffer.lastIndexOf(delimiter)).trim();
      if (hasSql(statement)) statements.push(statement);
      buffer = '';
    }
  }
  if (hasSql(buffer)) throw new Error('Unterminated SQL statement.');
  return statements;
}
