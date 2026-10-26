import { hospitalDatabase } from './hospital-database.mjs';

// Extends the isolated Profile database double with transactional registration.
// It never imports mysql2 or opens a database connection.
export function hospitalRegistrationDatabase() {
  const database = hospitalDatabase();
  database.accounts.clear();
  database.profiles.clear();
  database.donors = new Map();
  database.failStages = new Set();
  database.events = [];
  database.nextId = 1000n;
  database.insertIdOverride = undefined;
  database.missingInsertedProfile = false;
  database.destroyed = 0;
  const baseExecute = database.execute;
  function fail(stage) {
    if (database.failStages.has(stage)) throw new Error('private-registration-driver-detail SELECT password_hash');
  }
  function duplicate(key) {
    return Object.assign(new Error('private-registration-driver-detail'), {
      code: 'ER_DUP_ENTRY', sqlMessage: `private-registration-driver-detail ${key}`,
    });
  }
  database.execute = async (sql, values = []) => {
    if (sql.includes('FROM Account WHERE email = ?')) {
      database.calls.push({ sql, values: [...values] });
      const account = [...database.accounts.values()].find((row) => row.email === values[0]);
      return [account ? [{ account_id: account.accountId, role: account.role,
        account_status: account.accountStatus, email: account.email, password_hash: account.passwordHash }] : []];
    }
    if (sql.includes('FROM Hospital h JOIN Account')) {
      fail('profile');
      if (database.missingInsertedProfile) return [[]];
    }
    return baseExecute(sql, values);
  };
  database.getConnection = async () => {
    database.events.push('acquire');
    fail('acquire');
    let snapshot;
    let inTransaction = false;
    function restore() {
      for (const [target, saved] of [[database.accounts, snapshot.accounts],
        [database.profiles, snapshot.profiles], [database.donors, snapshot.donors]]) {
        target.clear();
        for (const [id, value] of saved) target.set(id, value);
      }
      inTransaction = false;
    }
    return {
      async beginTransaction() {
        database.events.push('begin');
        fail('begin');
        snapshot = structuredClone({ accounts: database.accounts, profiles: database.profiles, donors: database.donors });
        inTransaction = true;
        database.transactions.begun += 1;
      },
      async execute(sql, values = []) {
        if (!inTransaction) throw new Error('Registration writes require an isolated transaction.');
        if (sql.includes('INSERT INTO Account')) {
          database.events.push('account');
          fail('account');
          if ([...database.accounts.values()].some((row) => row.email.toLowerCase() === values[0].toLowerCase())) {
            throw duplicate('uq_account_email');
          }
          const role = sql.includes("'HOSPITAL'") ? 'HOSPITAL' : sql.includes("'DONOR'") ? 'DONOR' : 'INVALID';
          if (!sql.includes("'PENDING'") || role === 'INVALID') throw new Error('Unexpected server role/status SQL.');
          const id = String(database.nextId++);
          database.accounts.set(id, { accountId: id, email: values[0], passwordHash: values[1], role, accountStatus: 'PENDING' });
          database.calls.push({ sql, values: [...values] });
          return [{ insertId: database.insertIdOverride ?? id }];
        }
        if (sql.includes('INSERT INTO Hospital')) {
          database.events.push('hospital');
          fail('hospital');
          const [id, organizationName, registrationNumber, contactName, phone, address] = values;
          if (registrationNumber !== null && [...database.profiles.values()].some((row) =>
            row.registrationNumber?.toLowerCase() === registrationNumber.toLowerCase())) {
            throw duplicate('uq_hospital_registration_number');
          }
          database.profiles.set(id, { hospitalId: id, organizationName, registrationNumber, contactName, phone, address,
            createdAt: new Date('2026-10-25T04:30:00.000Z'), updatedAt: new Date('2026-10-25T04:30:00.000Z') });
          database.calls.push({ sql, values: [...values] });
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('INSERT INTO Donor')) {
          database.events.push('donor');
          database.donors.set(values[0], { values: [...values] });
          return [{ affectedRows: 1 }];
        }
        if (sql.includes('FROM Hospital h JOIN Account')) database.events.push('profile');
        return database.execute(sql, values);
      },
      async commit() {
        database.events.push('commit');
        fail('commit');
        database.transactions.committed += 1;
        inTransaction = false;
      },
      async rollback() {
        database.events.push('rollback');
        fail('rollback');
        restore();
        database.transactions.rolledBack += 1;
      },
      release() { database.events.push('release'); database.transactions.released += 1; },
      destroy() {
        database.events.push('destroy');
        if (inTransaction) restore();
        database.destroyed += 1;
      },
    };
  };
  return database;
}
