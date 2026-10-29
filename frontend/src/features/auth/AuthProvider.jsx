import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import { installSessionInvalidation, isSessionInvalidation } from '../../services/authFailure';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restoreError, setRestoreError] = useState('');
  const authVersion = useRef(0);

  useEffect(() => {
    return installSessionInvalidation(api, authVersion, () => {
      setUser(null);
      setRestoreError('');
    });
  }, []);

  const restore = useCallback(async () => {
    const startedAtVersion = authVersion.current;
    setLoading(true);
    setRestoreError('');
    try {
      const { data } = await api.get('/auth/me');
      if (startedAtVersion === authVersion.current) {
        authVersion.current += 1;
        setUser(data.user);
      }
    } catch (error) {
      if (!isSessionInvalidation(error) && startedAtVersion === authVersion.current) {
        setRestoreError(error?.response?.data?.error?.message || 'Could not check your sign-in status.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void restore(); }, [restore]);

  // Ref access closes the interval before React renders a login/logout change.
  // Consumers also receive the version as a render key, including same-ID login.
  const getAuthLifecycle = useCallback(() => authVersion.current, []);

  const getCsrfToken = useCallback(async (signal) => {
    const { data } = await api.get('/auth/csrf', { signal });
    return data.csrfToken;
  }, []);

  const login = useCallback(async (credentials) => {
    const csrfToken = await getCsrfToken();
    const { data } = await api.post('/auth/login', credentials, { headers: { 'X-CSRF-Token': csrfToken } });
    authVersion.current += 1;
    setUser(data.user);
    setRestoreError('');
    return data.user;
  }, [getCsrfToken]);

  const registerDonor = useCallback(async (profile) => {
    const csrfToken = await getCsrfToken();
    return api.post('/auth/register/donors', profile, { headers: { 'X-CSRF-Token': csrfToken } });
  }, [getCsrfToken]);

  const updateDonorProfile = useCallback(async (patch, { signal } = {}) => {
    const csrfToken = await getCsrfToken(signal);
    const { data } = await api.patch('/donors/me', patch, {
      signal, headers: { 'X-CSRF-Token': csrfToken },
    });
    return data.profile;
  }, [getCsrfToken]);

  const logout = useCallback(async () => {
    const csrfToken = await getCsrfToken();
    await api.post('/auth/logout', {}, { headers: { 'X-CSRF-Token': csrfToken } });
    authVersion.current += 1;
    setUser(null);
    setRestoreError('');
  }, [getCsrfToken]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const version = authVersion.current;
    const csrfToken = await getCsrfToken();
    if (version !== authVersion.current) return { obsolete: true };
    const { data } = await api.post('/auth/password', { currentPassword, newPassword }, { headers: { 'X-CSRF-Token': csrfToken } });
    if (version !== authVersion.current) return { obsolete: true };
    if (data?.success !== true || data.loginRequired !== true) throw Object.assign(new Error('Password change outcome is uncertain.'), { code: 'PASSWORD_OUTCOME_UNKNOWN' });
    authVersion.current += 1;
    setUser(null);
    setRestoreError('');
    return { success: true };
  }, [getCsrfToken]);

  const authLifecycle = authVersion.current;
  const value = useMemo(() => ({ user, loading, restoreError, login, registerDonor, updateDonorProfile, logout, changePassword, restore, authLifecycle, getAuthLifecycle }),
    [user, loading, restoreError, login, registerDonor, updateDonorProfile, logout, changePassword, restore, authLifecycle, getAuthLifecycle]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be rendered inside AuthProvider.');
  return context;
}
