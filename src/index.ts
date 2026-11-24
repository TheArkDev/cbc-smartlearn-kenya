import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { curriculum } from './routes/curriculum';
import { lessons } from './routes/lessons';

export type Env = { Bindings: { DB: D1Database } };

const app = new Hono<Env>();
app.use('*', cors());

app.get('/v1/health', (c) => c.json({ success: true, data: { status: 'ok' } }));
app.route('/v1/curriculum', curriculum);
app.route('/v1/lessons', lessons);

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: 'Internal error' }, 500); // no internals leaked
});

export default app;
