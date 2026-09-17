const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8000;

// ─────────────────────────────────────────────
//  CREDENTIALS  (change these before deploying)
// ─────────────────────────────────────────────
const USERS = {
  admin:  { password: 'admin123', role: 'admin' },
  ir:     { password: 'ir123',    role: 'ir'    },
};

// ─────────────────────────────────────────────
//  PROTECTED ROUTES  (role: any authenticated)
// ─────────────────────────────────────────────
const PROTECTED_PATHS = ['/ir-portal', '/ir-portal.html', '/IR_PITCH_PLAYBOOK.md'];

// ─────────────────────────────────────────────
//  IN-MEMORY SESSION STORE
// ─────────────────────────────────────────────
const sessions = {};   // token -> { username, role, expires }
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function createSession(username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { username, role, expires: Date.now() + SESSION_TTL_MS };
  return token;
}

function getSession(token) {
  const s = sessions[token];
  if (!s) return null;
  if (Date.now() > s.expires) { delete sessions[token]; return null; }
  return s;
}

function destroySession(token) {
  delete sessions[token];
}

// ─────────────────────────────────────────────
//  COOKIE HELPERS
// ─────────────────────────────────────────────
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}

function getToken(req) {
  return parseCookies(req.headers.cookie)['asc_session'] || null;
}

// ─────────────────────────────────────────────
//  MIME TYPES
// ─────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.md':   'text/markdown; charset=utf-8',
};

// ─────────────────────────────────────────────
//  COLLECT BODY
// ─────────────────────────────────────────────
function collectBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => resolve(body));
  });
}

function parseForm(body) {
  const out = {};
  body.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  });
  return out;
}

// ─────────────────────────────────────────────
//  SERVER
// ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // ── POST /login ──────────────────────────
  if (req.method === 'POST' && urlPath === '/login') {
    const body  = await collectBody(req);
    const { username, password } = parseForm(body);
    const user = USERS[username];
    if (user && user.password === password) {
      const token = createSession(username, user.role);
      res.writeHead(302, {
        'Set-Cookie': `asc_session=${token}; HttpOnly; Path=/; SameSite=Strict`,
        'Location': '/ir-portal',
      });
      res.end();
    } else {
      res.writeHead(302, { 'Location': '/login?error=1' });
      res.end();
    }
    return;
  }

  // ── GET /logout ───────────────────────────
  if (urlPath === '/logout') {
    const token = getToken(req);
    if (token) destroySession(token);
    res.writeHead(302, {
      'Set-Cookie': 'asc_session=; HttpOnly; Path=/; Max-Age=0',
      'Location': '/',
    });
    res.end();
    return;
  }

  // ── PROTECTED ROUTES ──────────────────────
  const isProtected = PROTECTED_PATHS.some(p => urlPath === p || urlPath.startsWith(p));
  if (isProtected) {
    const session = getSession(getToken(req));
    if (!session) {
      res.writeHead(302, { 'Location': '/login' });
      res.end();
      return;
    }
  }

  // ── STATIC FILES & CLEAN URL REWRITE ─────
  let resolvedPath = urlPath;
  if (resolvedPath === '/ir-portal') resolvedPath = '/ir-portal.html';
  if (resolvedPath === '/login') resolvedPath = '/login.html';

  let filePath = path.join(__dirname, decodeURIComponent(resolvedPath));
  let ext = path.extname(filePath).toLowerCase();

  // If path doesn't have an extension, try appending .html
  if (!ext && fs.existsSync(filePath + '.html')) {
    filePath += '.html';
    ext = '.html';
  }

  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`500 Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ascendia Pitch Deck Server running at http://localhost:${PORT}/`);
  console.log(`IR Portal: http://localhost:${PORT}/ir-portal`);
});
