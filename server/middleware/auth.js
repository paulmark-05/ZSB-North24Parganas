const jwt = require('jsonwebtoken');

const SECRET = () => process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role || 'admin' },
    SECRET(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }
  try {
    req.user = jwt.verify(token, SECRET());
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Session expired or invalid. Please sign in again.' });
  }
}

module.exports = { signToken, requireAuth };
