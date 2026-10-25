import assert from 'node:assert/strict';
import { hospitalDatabase } from './hospital-database.mjs';

// Extend the isolated session/login database double only for the existing
// Hospital directory's SELECTs. No connection, credentials or live data exist.
export function adminHospitalDatabase() {
  const database = hospitalDatabase();
  const originalExecute = database.execute;
  database.execute = async (sql, values = []) => {
    const query = sql.replace(/\s+/gu, ' ').trim();
    if (!query.includes('FROM Hospital h JOIN Account') || query.includes('WHERE h.account_id = ?')) {
      return originalExecute(sql, values);
    }
    database.calls.push({ sql: query, values: [...values] });
    if (database.failSql?.(query)) throw new Error('private-driver-detail SELECT password_hash');
    assert.ok(query.includes("a.role = 'HOSPITAL'"));
    let parameter = 0;
    let search = '';
    if (query.includes('LIKE ?')) {
      const patterns = values.slice(0, 4);
      assert.equal(patterns.length, 4);
      assert.ok(patterns.every((pattern) => pattern === patterns[0]));
      assert.equal((query.match(/LIKE \? ESCAPE '!'/gu) ?? []).length, 4);
      search = patterns[0].slice(1, -1).replace(/!([!%_])/gu, '$1').toLowerCase();
      parameter += 4;
    }
    const status = query.includes('a.account_status = ?') ? values[parameter++] : undefined;
    let rows = [...database.profiles.values()].filter((profile) => {
      const account = database.accounts.get(profile.hospitalId);
      return account?.role === 'HOSPITAL' && (!status || account.accountStatus === status)
        && (!search || [profile.organizationName, profile.registrationNumber, profile.contactName, profile.phone]
          .some((value) => value?.toLowerCase().includes(search)));
    });
    if (query.startsWith('SELECT COUNT(*) AS total')) {
      assert.equal(values.length, parameter);
      return [[{ total: String(rows.length) }]];
    }
    assert.ok(query.includes('ORDER BY h.organization_name, h.account_id LIMIT ? OFFSET ?'));
    assert.equal(values.length, parameter + 2);
    const [limit, offset] = values.slice(parameter);
    rows.sort((left, right) => left.organizationName.localeCompare(right.organizationName)
      || (BigInt(left.hospitalId) < BigInt(right.hospitalId) ? -1 : 1));
    rows = rows.slice(offset, offset + limit);
    return [rows.map((profile) => ({ ...profile, accountStatus: database.accounts.get(profile.hospitalId).accountStatus }))];
  };
  return database;
}
