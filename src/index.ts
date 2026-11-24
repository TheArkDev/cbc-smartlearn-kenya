import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './routes/auth';
import { guardians } from './routes/guardians';
import { curriculum } from './routes/curriculum';
import { lessons } from './routes/lessons';
import type { AuthUser } from './guards';

export type Env = {
  Bindings: { DB: D1Database; JWT_SECRET: string };
  Variables: { user: AuthUser };
};

const app = new Hono<Env>();
app.use('*', cors());

app.get('/v1/health', (c) =>
  c.json({
    success: true,
    data: { status: 'ok', jwt_secret_ok: !!c.env.JWT_SECRET && c.env.JWT_SECRET.length >= 32 },
  })
);

// Refuse to run account routes if the signing secret was never configured.
app.use('/v1/auth/*', async (c, next) => {
  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32)
    return c.json({ success: false, error: 'Server not configured' }, 500);
  await next();
});
app.use('/v1/guardians/*', async (c, next) => {
  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32)
    return c.json({ success: false, error: 'Server not configured' }, 500);
  await next();
});

app.route('/v1/auth', auth);
app.route('/v1/guardians', guardians);
app.route('/v1/curriculum', curriculum);
app.route('/v1/lessons', lessons);

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: 'Internal error' }, 500);
});

export default app;
