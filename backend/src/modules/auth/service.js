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

    async authenticate(email, password) {
      try {
        const account = await repository.findAccountByEmail(email);
        const matches = account ? await passwordHasher.compare(password, account.passwordHash) : false;
        if (!account || !matches) throw new HttpError(LOGIN_FAILURE.status, LOGIN_FAILURE.code, LOGIN_FAILURE.message);
        const supportedRole = ['DONOR', 'HOSPITAL', 'ADMIN'].includes(account.role);
        const allowedStatus = account.accountStatus === 'ACTIVE'
          || (account.role !== 'ADMIN' && account.accountStatus === 'PENDING');
        if (!supportedRole || !allowedStatus) throw new HttpError(LOGIN_FAILURE.status, LOGIN_FAILURE.code, LOGIN_FAILURE.message);
        return { accountId: String(account.accountId), role: account.role, accountStatus: account.accountStatus };
      } catch (error) {
        if (error instanceof HttpError && error.code === LOGIN_FAILURE.code) throw error;
        throw databaseFailure(error);
      }
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
