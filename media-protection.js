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

    // Les URLs signées sont valables 15 minutes maximum.
    const TOKEN_TTL = 15 * 60 * 1000;
    setInterval(() => {
        const now = Date.now();
        for (const [token, info] of tokenMap.entries()) {
            if (now >= info.expiresAt) tokenMap.delete(token);
        }
    }, 5 * 60 * 1000).unref();

    function makeToken(absPath, sessionId) {
        const sig = crypto.createHmac('sha256', SESSION_SECRET)
            .update((sessionId || 'anon') + '|' + absPath + '|' + Date.now())
            .digest('hex')
            .substring(0, 12);
        const id = crypto.randomBytes(4).toString('hex');
        const token = id + sig;
        tokenMap.set(token, { path: absPath, ts: Date.now(), expiresAt: Date.now() + TOKEN_TTL });
        return token;
    }

    // 1. Endpoint de signature (rapide)
    app.get('/api/media/sign', (req, res) => {
        try {
            const url = req.query.url;
            if (!url || typeof url !== 'string' || url.indexOf('/uploads/') !== 0) {
                return res.status(400).json({ error: 'Invalid url' });
            }
            if (typeof opts.isPublishedMedia === 'function' && !opts.isPublishedMedia(url)) {
                return res.status(403).json({ error: 'Media not attached to a published post' });
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
        if (!info || Date.now() >= info.expiresAt) {
            tokenMap.delete(req.params.token);
            return res.status(404).send('Expired');
        }
        if (!fs.existsSync(info.path)) return res.status(404).send('Gone');

        const ext = path.extname(info.path).toLowerCase();
        const mimeMap = {
            '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml',
            '.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.avi':'video/x-msvideo','.mkv':'video/x-matroska',
            '.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.oga':'audio/ogg','.flac':'audio/flac',
            '.pdf':'application/pdf','.txt':'text/plain','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        };
        const mime = mimeMap[ext] || 'application/octet-stream';

        res.set({
            'Cache-Control': 'private, no-store, max-age=0',
            'Content-Type': mime,
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Disposition': mime === 'application/octet-stream' ? 'attachment' : 'inline'
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
