import { api } from './api';

export async function checkHealth(path, signal) {
  try {
    const { data } = await api.get(path, { signal });
    const valid = path === '/health/db'
      ? data?.success === true && data?.database === 'connected'
      : data?.success === true && data?.message === 'Blood Donation Coordination System API is running';

    return valid
      ? { state: 'connected', message: path === '/health/db' ? 'MySQL responded to the connectivity check.' : 'The Express API is responding.' }
      : { state: 'unavailable', message: 'The service returned an unexpected health response.' };
  } catch (error) {
    if (signal.aborted) return null;
    if (error.response?.status === 503 && path === '/health/db') {
      const unconfigured = error.response.data?.error?.code === 'DATABASE_NOT_CONFIGURED';
      return {
        state: 'unavailable',
        message: unconfigured ? 'Configure the database settings in backend/.env.' : 'MySQL is unavailable. Check the service and backend settings.',
      };
    }
    return { state: 'unavailable', message: 'Unable to reach the API. Check the backend server and API URL.' };
  }
}
