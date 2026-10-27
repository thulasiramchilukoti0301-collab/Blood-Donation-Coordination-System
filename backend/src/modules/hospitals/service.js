import { HttpError } from '../../utils/httpError.js';
import { safeHospitalError } from './errors.js';
import { accountId, validateContactPatch, validateHospitalQuery } from './validation.js';

const notFound = () => new HttpError(404, 'HOSPITAL_NOT_FOUND', 'Hospital profile was not found.');
const forbidden = () => new HttpError(403, 'FORBIDDEN', 'This Hospital operation is not permitted.');
const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required.');

// trustedPrincipal must originate from Thulasi's verified server-side session.
// It is NOT a request body/query parameter. Read-side domain checks follow the
// HTTP session guard; writes additionally revalidate the stored SID under locks.
export function createHospitalService({ repository }) {
  async function authorize(repo, trustedPrincipal, role, forUpdate = false) {
    if (!trustedPrincipal || !Object.hasOwn(trustedPrincipal, 'accountId')) throw unauthenticated();
    let id;
    try { id = accountId(trustedPrincipal.accountId); } catch { throw unauthenticated(); }
    const current = await repo.findAccountById(id, { forUpdate });
    if (!current) throw unauthenticated();
    const allowedStatus = role === 'ADMIN' ? ['ACTIVE'] : ['PENDING', 'ACTIVE'];
    if (current.role !== role || !allowedStatus.includes(current.accountStatus)) throw forbidden();
    if (forUpdate) await repo.authorizeSession(trustedPrincipal.session, current);
    return id;
  }
  async function safely(work) {
    try { return await work(); } catch (error) { throw safeHospitalError(error); }
  }
  return {
    getOwnProfile(trustedPrincipal) {
      return safely(async () => {
        const id = await authorize(repository, trustedPrincipal, 'HOSPITAL');
        const profile = await repository.findProfileByAccountId(id);
        if (!profile) throw notFound();
        return profile;
      });
    },
    updateOwnProfile(trustedPrincipal, input) {
      return safely(async () => {
        // Check identity before parsing client data. Recheck/lock Account inside
        // the transaction so suspension cannot race a successful mutation.
        await authorize(repository, trustedPrincipal, 'HOSPITAL');
        const patch = validateContactPatch(input);
        return repository.withTransaction(async (transaction) => {
          const id = await authorize(transaction, trustedPrincipal, 'HOSPITAL', true);
          if (!await transaction.findProfileByAccountId(id, { forUpdate: true })) throw notFound();
          const updated = await transaction.updateContactProfile(id, patch);
          if (!updated) throw notFound();
          return updated;
        });
      });
    },
    listHospitals(trustedPrincipal, query) {
      return safely(async () => {
        await authorize(repository, trustedPrincipal, 'ADMIN');
        return repository.listHospitals(validateHospitalQuery(query));
      });
    },
    // Profile component only. The approved Admin detail response also needs a
    // request summary, which must wait for the separate request feature.
    getHospitalProfileForAdmin(trustedPrincipal, hospitalId) {
      return safely(async () => {
        await authorize(repository, trustedPrincipal, 'ADMIN');
        const profile = await repository.findProfileByAccountId(accountId(hospitalId));
        if (!profile) throw notFound();
        return profile;
      });
    },
  };
}
