import webpush from 'web-push';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);

    webpush.setVapidDetails(
      'mailto:habits@localhost',
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY
    );

    try {
      const body = await request.json();

      if (url.pathname === '/schedule') {
        return handleSchedule(env.DB, body);
      }
      if (url.pathname === '/cancel') {
        return handleCancel(env.DB, body);
      }
      if (url.pathname === '/unsubscribe') {
        return handleUnsubscribe(env.DB, body);
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      return new Response('Bad request', { status: 400 });
    }
  },

  async scheduled(event, env, ctx) {
    webpush.setVapidDetails(
      'mailto:habits@localhost',
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY
    );
    await handleCron(env.DB);
  }
};

async function handleSchedule(db, { deviceId, subscription, title, body, tag, sig, fireAt }) {
  await db.prepare(
    `INSERT OR REPLACE INTO scheduled_pushes (device_id, sig, fire_at, subscription, title, body, tag)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    deviceId,
    sig,
    fireAt,
    JSON.stringify(subscription),
    title,
    body || null,
    tag
  ).run();

  return new Response('OK', { status: 200 });
}

async function handleCancel(db, { deviceId, sig }) {
  await db.prepare(
    'DELETE FROM scheduled_pushes WHERE device_id = ? AND sig = ?'
  ).bind(deviceId, sig).run();

  return new Response('OK', { status: 200 });
}

async function handleUnsubscribe(db, { deviceId }) {
  await db.prepare(
    'DELETE FROM scheduled_pushes WHERE device_id = ?'
  ).bind(deviceId).run();

  return new Response('OK', { status: 200 });
}

async function handleCron(db) {
  const now = Date.now();

  const { results } = await db.prepare(
    'SELECT rowid, * FROM scheduled_pushes WHERE fire_at <= ?'
  ).bind(now).all();

  if (!results || results.length === 0) return;

  const fired = [];

  for (const row of results) {
    try {
      const sub = typeof row.subscription === 'string'
        ? JSON.parse(row.subscription)
        : row.subscription;

      await webpush.sendNotification(sub, JSON.stringify({
        title: row.title,
        body: row.body,
        tag: row.tag
      }), { TTL: 0 });

      fired.push(row.rowid);
    } catch (err) {
      // 410 Gone or 404 Not Found → subscription is dead, remove it
      if (err.statusCode === 410 || err.statusCode === 404) {
        fired.push(row.rowid);
      }
    }
  }

  if (fired.length > 0) {
    const ph = fired.map(() => '?').join(',');
    await db.prepare(
      `DELETE FROM scheduled_pushes WHERE rowid IN (${ph})`
    ).bind(...fired).run();
  }
}
