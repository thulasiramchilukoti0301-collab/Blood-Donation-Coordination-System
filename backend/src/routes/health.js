import { Router } from 'express';

export function createHealthRouter(verifyDatabase) {
  const router = Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', (req, res) => {
    res.json({ success: true, message: 'Blood Donation Coordination System API is running' });
  });

  router.get('/db', async (req, res) => {
    await verifyDatabase();
    res.json({ success: true, database: 'connected' });
  });

  return router;
}
