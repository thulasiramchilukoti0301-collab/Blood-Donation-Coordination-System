import bcrypt from 'bcrypt';
import { HttpError } from '../../utils/httpError.js';
import { BCRYPT_WORK_FACTOR } from './passwordPolicy.js';

const LOGIN_FAILURE = Object.freeze({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Email or password is invalid.' });

function databaseFailure(error) {
  if (error instanceof HttpError) return error;
  if (error?.code === 'ER_DUP_ENTRY') {
    return new HttpError(409, 'EMAIL_CONFLICT', 'An account with this email already exists.');
  }
  if (error?.code === 'ER_NO_REFERENCED_ROW_2' || error?.code === 'ER_NO_REFERENCED_ROW') {
    return new HttpError(422, 'INVALID_BLOOD_GROUP', 'Choose an available blood group or leave it blank.');
  }
  return new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable or required account/profile schema is missing.');
}

export function createAuthService({ repository, passwordHasher = bcrypt, bcryptWorkFactor = BCRYPT_WORK_FACTOR }) {
  if (!repository) throw new TypeError('An authentication repository is required.');

  function permitted(account) {
    return account && ['DONOR', 'HOSPITAL', 'ADMIN'].includes(account.role)
      && (account.accountStatus === 'ACTIVE' || (account.role !== 'ADMIN' && account.accountStatus === 'PENDING'));
  }
  function invalidLogin() { return new HttpError(LOGIN_FAILURE.status, LOGIN_FAILURE.code, LOGIN_FAILURE.message); }
  function identity(account) { return { accountId: String(account.accountId), role: account.role, accountStatus: account.accountStatus }; }
  async function verifyCredentials(email, password) {
    const account = await repository.findAccountByEmail(email);
    const matches = account ? await passwordHasher.compare(password, account.passwordHash) : false;
    if (!matches || !permitted(account)) throw invalidLogin();
    return account;
  }

  return {
    async registerDonor(donor) {
      let passwordHash;
      try {
        passwordHash = await passwordHasher.hash(donor.password, bcryptWorkFactor);
      } catch (error) {
        throw new HttpError(503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication is temporarily unavailable.');
      }
      const { password: discardedPassword, ...safeDonor } = donor;
      void discardedPassword;
      try { return await repository.createDonorAccountProfile({ ...safeDonor, passwordHash }); }
      catch (error) { throw databaseFailure(error); }
    },

    async registerHospital(hospital) {
      let passwordHash;
      try {
        passwordHash = await passwordHasher.hash(hospital.password, bcryptWorkFactor);
      } catch {
        throw new HttpError(503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication is temporarily unavailable.');
      }
      const { password: discardedPassword, ...safeHospital } = hospital;
      void discardedPassword;
      try { return await repository.createHospitalAccountProfile({ ...safeHospital, passwordHash }); }
      catch (error) { throw databaseFailure(error); }
    },

    async authenticate(email, password) {
      try {
        return identity(await verifyCredentials(email, password));
      } catch (error) {
        if (error instanceof HttpError && error.code === LOGIN_FAILURE.code) throw error;
        throw databaseFailure(error);
      }
    },

    async establishSession(email, password, persist) {
      try {
        // bcrypt runs before taking database locks. Never authorize solely from
        // this snapshot: email/hash/role and current status are rechecked below.
        const verified = await verifyCredentials(email, password);
        return await repository.withLockedAccount(verified.accountId, async (locked, connection) => {
          if (!permitted(locked) || locked.passwordHash !== verified.passwordHash
            || locked.email !== verified.email || locked.role !== verified.role) throw invalidLogin();
          const account = identity(locked);
          await persist(account, connection);
          return account;
        });
      } catch (error) { throw databaseFailure(error); }
    },

    async currentAccount(accountId) {
      try { return await repository.findAccountById(String(accountId)); }
      catch (error) { throw databaseFailure(error); }
    },

    async donorProfile(accountId) {
      try { return await repository.findDonorProfile(String(accountId)); }
      catch (error) { throw databaseFailure(error); }
    },
  };
}
