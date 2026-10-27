const express = require('express');
const { timingSafeEqual } = require('node:crypto');

process.once('message', ({ dataDir, secret }) => {
  process.env.LEMONHOUSE_CONSTRUCTION_DATA_DIR = dataDir;
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const token = Buffer.from(String(req.headers['x-construction-secret'] || ''));
    const expected = Buffer.from(secret);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) return res.sendStatus(403);
    next();
  });
  app.post('/session', express.json({limit:'64kb'}), (req, res) => {
    require('./cafe/chrome').useStudioCookies(req.body.cookies);
    res.json({ok:true});
  });
  require('./cafe/routes').mount(app);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 400).json({ error: error.message || '카페 작업을 완료하지 못했습니다.' });
  });
  const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  server.on('error', error => { process.send({ error: error.message }); process.exitCode = 1; });
  process.on('disconnect', () => process.exit());
});
