// ============================================================
// 🛡️ MEDIA PROTECTION MODULE — add-on for Goût Gueule
// ============================================================
// Ce module peut être désactivé en commentant la ligne
//   require('./media-protection')(app, ...);
// dans server.js. Tant qu'il est MONOLITHIQUE et INDÉPENDANT,
// un crash éventuel n'affecte PAS le reste du serveur.
//
// Activé (fail-open) : toutes les routes ajoutées sont *silencieuses*
// en cas d'erreur. Le serveur continue de fonctionner.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function installMediaProtection(app, opts) {
    opts = opts || {};
    const UPLOAD_DIR = opts.uploadDir || path.join(__dirname, 'uploads');
    const SESSION_SECRET = opts.sessionSecret || opts.secret || process.env.MEDIA_SECRET || 'gg-secret-2026-fallback';

    // Map en mémoire : token -> absolutePath
    const tokenMap = new Map();

    // Cleanup auto toutes les 10 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [token, info] of tokenMap.entries()) {
            if (now - info.ts > 60 * 60 * 1000) tokenMap.delete(token);
        }
    }, 10 * 60 * 1000).unref();

    function makeToken(absPath, sessionId) {
        const sig = crypto.createHmac('sha256', SESSION_SECRET)
            .update((sessionId || 'anon') + '|' + absPath + '|' + Date.now())
            .digest('hex')
            .substring(0, 12);
        const id = crypto.randomBytes(4).toString('hex');
        const token = id + sig;
        tokenMap.set(token, { path: absPath, ts: Date.now() });
        return token;
    }

    // 1. Endpoint de signature (rapide)
    app.get('/api/media/sign', (req, res) => {
        try {
            const url = req.query.url;
            if (!url || typeof url !== 'string' || url.indexOf('/uploads/') !== 0) {
                return res.status(400).json({ error: 'Invalid url' });
            }
            const filename = url.substring('/uploads/'.length);
            // Anti-path-traversal
            if (filename.indexOf('..') !== -1 || filename.indexOf('/') !== -1 || filename.indexOf('\\') !== -1) {
                return res.status(400).json({ error: 'Invalid path' });
            }
            const absPath = path.join(UPLOAD_DIR, filename);
            if (absPath.indexOf(UPLOAD_DIR) !== 0 || !fs.existsSync(absPath)) {
                return res.status(404).json({ error: 'Not found' });
            }
            const token = makeToken(absPath, req.sessionID);
            res.json({ url: '/media/' + token });
        } catch (e) {
            // Fail-open : on renverra l'original par défaut
            res.json({ url: req.query.url });
        }
    });

    // 2. Sert le média protégé (token-bound)
    app.get('/media/:token', (req, res) => {
        const info = tokenMap.get(req.params.token);
        if (!info) return res.status(404).send('Not found');
        if (!fs.existsSync(info.path)) return res.status(404).send('Gone');

        const ext = path.extname(info.path).toLowerCase();
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.png' ? 'image/png'
            : ext === '.webp' ? 'image/webp'
            : ext === '.gif' ? 'image/gif'
            : ext === '.mp4' ? 'video/mp4'
            : ext === '.webm' ? 'video/webm'
            : ext === '.mov' ? 'video/quicktime'
            : 'application/octet-stream';

        res.set({
            'Cache-Control': 'private, no-store, max-age=0',
            'Content-Type': mime,
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin'
        });
        res.sendFile(info.path);
    });

    // 3. Variante publique pour og:image (Facebook doit pouvoir fetch)
    app.get('/media-public/:filename', (req, res) => {
        try {
            const filename = (req.params.filename || '').replace(/[^a-zA-Z0-9._-]/g, '');
            if (!filename) return res.status(404).send('Not found');
            const absPath = path.join(UPLOAD_DIR, filename);
            if (absPath.indexOf(UPLOAD_DIR) !== 0 || !fs.existsSync(absPath)) {
                return res.status(404).send('Not found');
            }
            res.set('Cache-Control', 'public, max-age=86400');
            res.sendFile(absPath);
        } catch (e) {
            res.status(404).send('Not found');
        }
    });

    // 4. Tracking des tentatives (admin-only)
    const securityEvents = [];
    app.post('/api/events/:type', (req, res) => {
        try {
            const evt = {
                type: String(req.params.type).substring(0, 50),
                ts: Date.now(),
                ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString().split(',')[0].trim(),
                ua: (req.get('user-agent') || '').substring(0, 100)
            };
            securityEvents.push(evt);
            if (securityEvents.length > 500) securityEvents.shift();
        } catch (e) { /* fail-open */ }
        res.json({ ok: true });
    });

    app.get('/api/admin/security-events', (req, res) => {
        if (typeof opts.isAdmin === 'function' && !opts.isAdmin(req)) {
            return res.status(403).json({ error: 'forbidden' });
        }
        res.json(securityEvents.slice(-50).reverse());
    });

    console.log('[media-protection] Module loaded (3 routes + signing API + tracking)');
};
