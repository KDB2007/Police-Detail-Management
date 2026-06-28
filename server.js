const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDb } = require('./database/schema');
const { loadUserPermissions } = require('./middleware/auth');
const SQLiteSessionStore = require('./middleware/sessionStore');

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:4000').split(',');

initDb();

// Auto-seed on first run (empty database)
const { getDb } = require('./database/schema');
const userCount = getDb().prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  console.log('Empty database detected — running seed...');
  require('./database/seed');
}

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.some(o => origin.includes(o.trim()))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || 'pdm-secret-key-2024-enterprise',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(loadUserPermissions);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.renderWithLayout = (view, data = {}) => {
    const layout = data.layout || 'layouts/main';
    res.render(view, data, (err, content) => {
      if (err) return res.status(500).send(err.message);
      res.render(layout, { ...data, body: content });
    });
  };
  next();
});

const { requireAuth } = require('./middleware/auth');

app.use('/', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/slips', require('./routes/slips'));
app.use('/invoices', require('./routes/invoices'));
app.use('/admin', require('./routes/admin'));
app.use('/reports', require('./routes/reports'));
app.use('/notifications', require('./routes/notifications'));
app.use('/api', require('./routes/api'));

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  const db = require('./database/schema').getDb();
  const orgs = db.prepare('SELECT * FROM organizations WHERE is_active = 1').all();
  res.renderWithLayout('landing', { user: null, orgs, title: 'Welcome' });
});

app.use((req, res, next) => {
  res.status(404).renderWithLayout('error', { user: req.session && req.session.user || null, message: 'The page you requested was not found', error: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).renderWithLayout('error', { user: req.session && req.session.user || null, message: 'Internal server error', error: 'Server Error' });
});

app.listen(PORT, HOST, () => {
  const addr = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`PDM Platform running at ${addr}`);
  console.log(`  Network access: http://<your-ip>:${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
});
