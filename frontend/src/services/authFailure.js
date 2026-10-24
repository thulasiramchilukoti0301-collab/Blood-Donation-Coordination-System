const SESSION_INVALID_CODES = new Set(['AUTHENTICATION_REQUIRED', 'ACCOUNT_UNAVAILABLE']);

export function isSessionInvalidation(error) {
  return error?.response?.status === 401
    && SESSION_INVALID_CODES.has(error.response.data?.error?.code);
}

export function installSessionInvalidation(client, authVersion, onInvalidation) {
  const requestInterceptor = client.interceptors.request.use((config) => {
    config.authVersion = authVersion.current;
    return config;
  });
  const responseInterceptor = client.interceptors.response.use(undefined, (error) => {
    if (isSessionInvalidation(error) && error.config?.authVersion === authVersion.current) {
      authVersion.current += 1;
      onInvalidation();
    }
    return Promise.reject(error);
  });
  return () => {
    client.interceptors.request.eject(requestInterceptor);
    client.interceptors.response.eject(responseInterceptor);
  };
}
