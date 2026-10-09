import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  timeout: 8000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});
