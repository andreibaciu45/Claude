// Lettura documenti del tenant (la scrittura passa SOLO dal sync). GET /v1/documents · GET /v1/documents/:id
import { Hono } from 'hono';
import { apiError, intParam } from '../auth/http';
import { requireAuth, type AuthEnv } from '../auth/middleware';
import { getDocument, listDocuments } from './repo';

export const documentRoutes = new Hono<AuthEnv>();
documentRoutes.use('*', requireAuth);

documentRoutes.get('/', (c) => {
  const limit = intParam(c.req.query('limit'), 100, 1, 200);
  const offset = intParam(c.req.query('offset'), 0, 0, 1_000_000_000);
  return c.json({ documents: listDocuments(c.get('tenantId'), limit, offset) });
});

documentRoutes.get('/:id', (c) => {
  const doc = getDocument(c.get('tenantId'), c.req.param('id'));
  return doc ? c.json(doc) : apiError(c, 404, 'not_found', 'Documento non trovato');
});
