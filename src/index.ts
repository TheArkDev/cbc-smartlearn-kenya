import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './routes/auth';
import { guardians } from './routes/guardians';
import { curriculum } from './routes/curriculum';
import { lessons } from './routes/lessons';
import { assessments, progress } from './routes/assessments';
import { review } from './routes/review';
import { learner } from './routes/learner';
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
    data: {
      status: 'ok',
      jwt_secret_set: !!c.env.JWT_SECRET,
      jwt_secret_long_enough: (c.env.JWT_SECRET ?? '').length >= 32,
    },
  })
);

// Refuse to run account routes if the signing secret was never configured.
const needSecret = async (c: any, next: any) => {
  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32)
    return c.json({ success: false, error: 'Server not configured' }, 500);
  await next();
};
for (const p of ['/v1/auth/*', '/v1/guardians/*', '/v1/assessments/*', '/v1/progress/*', '/v1/review/*', '/v1/learner/*']) {
  app.use(p, needSecret);
}

app.route('/v1/auth', auth);
app.route('/v1/guardians', guardians);
app.route('/v1/curriculum', curriculum);
app.route('/v1/lessons', lessons);
app.route('/v1/assessments', assessments);
app.route('/v1/progress', progress);
app.route('/v1/review', review);
app.route('/v1/learner', learner);

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, error: 'Internal error' }, 500);
});

export default app;
