const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const http = require('http');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const CMS = require('./cms');
const { marked } = require('marked');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const STORAGE_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(STORAGE_DIR, 'data.json');
const UPLOAD_DIR = path.join(STORAGE_DIR, 'uploads');

// Ensure storage and uploads dir exists
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// DB Initialization
let db = {
    users: [],
    posts: [],
    stories: [],
    subscribers: [],
    settings: {
        pageName: 'Goût Gueule',
        bio: 'Bienvenue sur Goût Gueule, votre destination gourmande.',
        social: {},
        smtp: {}
    },
    apiKeys: [],
    cms_integrations: {}
};

if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} else {
    saveDb();
}

function saveDb() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// --- SEO-FRIENDLY POST PAGE (SSR) ---
app.get('/post/:id/:slug?', (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id && !p.deleted);
    if (!post) return res.status(404).send('<h1>Article introuvable</h1>');
    const html = marked.parse(post.content || '');
    const ogImage = (post.media && post.media[0] && post.media[0].url) || '/og-image.jpg';
    const ogImageUrl = ogImage.startsWith('http') ? ogImage : `https://gout-gueule-fcvr.onrender.com${ogImage}`;
    const description = (post.content || '').replace(/[#*`>\n\[\]]/g, ' ').substring(0, 160).trim();
    const pageUrl = `https://gout-gueule-fcvr.onrender.com/post/${post.id}/${slugify(post.title)}`;
    const fullTitle = `${post.title} | Goût Gueule`;

    res.type('html').send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="keywords" content="${(post.tags || []).join(', ')}, kinshasa, RDC, cuisine congolaise">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${pageUrl}">

<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${ogImageUrl}">
<meta property="og:site_name" content="Goût Gueule">
<meta property="og:locale" content="fr_CD">
<meta property="article:published_time" content="${post.createdAt}">
<meta property="article:author" content="Goût Gueule">
${(post.tags || []).map(t => `<meta property="article:tag" content="${escapeHtml(t)}">`).join('\n')}

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(fullTitle)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${ogImageUrl}">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": ${JSON.stringify(post.title)},
  "description": ${JSON.stringify(description)},
  "image": ${JSON.stringify(ogImageUrl)},
  "datePublished": "${post.createdAt}",
  "author": { "@type": "Organization", "name": "Goût Gueule" },
  "publisher": {
    "@type": "Organization",
    "name": "Goût Gueule",
    "logo": { "@type": "ImageObject", "url": "https://gout-gueule-fcvr.onrender.com/og-image.jpg" }
  },
  "mainEntityOfPage": "${pageUrl}"
}
</script>

<style>
body { font-family: 'Inter', -apple-system, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; background: #FAF7F2; color: #2C1810; line-height: 1.6; }
.back { display: inline-block; color: #C0392B; text-decoration: none; font-weight: 600; margin-bottom: 20px; }
h1 { font-family: 'Playfair Display', serif; font-size: 36px; margin: 12px 0; color: #C0392B; }
.meta { color: #6B6B6B; font-size: 14px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #E8E3DC; }
.meta .tag { display: inline-block; background: #FAF7F2; border: 1px solid #D4A853; color: #D4A853; padding: 3px 10px; border-radius: 12px; font-size: 12px; margin-right: 6px; }
img { max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; }
blockquote { border-left: 4px solid #D4A853; padding-left: 16px; color: #6B6B6B; font-style: italic; margin: 16px 0; }
h2 { font-family: 'Playfair Display', serif; color: #96241A; margin-top: 32px; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #E8E3DC; padding: 8px 12px; text-align: left; }
th { background: #FAF7F2; font-weight: 700; }
.footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #E8E3DC; text-align: center; color: #6B6B6B; font-size: 14px; }
.footer a { color: #C0392B; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
<a href="/" class="back">← Retour à Goût Gueule</a>
<article>
<h1>${escapeHtml(post.title)}</h1>
<div class="meta">
  <strong>Goût Gueule</strong> · ${new Date(post.createdAt).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
  ${post.tags && post.tags.length ? '<br>' + post.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('') : ''}
</div>
${html}
</article>
<div class="footer">
  <p>Vous avez aimé cet article ? Partagez-le :</p>
  <p>
    <a href="https://wa.me/?text=${encodeURIComponent(post.title + ' — ' + pageUrl)}" target="_blank">WhatsApp</a> ·
    <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}" target="_blank">Facebook</a> ·
    <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(pageUrl)}" target="_blank">Twitter</a>
  </p>
  <p style="margin-top:24px;"><a href="/">← Découvrir plus d'articles sur Goût Gueule</a></p>
</div>
</body>
</html>`);
});

function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
app.use(session({
    secret: process.env.SESSION_SECRET || 'gout-gueule-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Multer Storage
const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
        cb(null, uuidv4() + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// WebSocket Broadcaster
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Auth Helpers
const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.status(403).json({ error: 'Admin access required' });
};

const isUser = (req, res, next) => {
    if (req.session.userId || req.session.isAdmin) return next();
    res.status(401).json({ error: 'Login required' });
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (db.users.find(u => u.email === email)) return res.status(409).json({ error: 'User exists' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = { id: uuidv4(), name, email, password: hashedPassword, createdAt: new Date().toISOString() };
    db.users.push(user);
    saveDb();
    res.json({ success: true });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    // Check Admin
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@goutgueule.com';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    if (email === adminEmail && password === adminPass) {
        req.session.isAdmin = true;
        return res.json({ success: true, isAdmin: true, user: { name: 'Admin', email: adminEmail } });
    }
    // Check User
    const user = db.users.find(u => u.email === email);
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user.id;
        req.session.userName = user.name;
        return res.json({ success: true, user: { name: user.name, email: user.email } });
    }
    res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/auth/me', (req, res) => {
    if (req.session.isAdmin) return res.json({ isAdmin: true, user: { name: 'Admin' } });
    if (req.session.userId) return res.json({ userId: req.session.userId, user: { name: req.session.userName } });
    res.json({ user: null });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// --- POSTS ROUTES ---
const slugify = (text) => {
    return (text || '')
        .toString()
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire accents
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80);
};

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: https://gout-gueule-fcvr.onrender.com/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
    const base = 'https://gout-gueule-fcvr.onrender.com';
    const posts = db.posts.filter(p => !p.deleted);
    const urls = [
        { loc: base + '/', priority: '1.0', changefreq: 'daily' },
        ...posts.map(p => ({
            loc: `${base}/post/${p.id}/${slugify(p.title)}`,
            lastmod: p.updatedAt || p.createdAt,
            priority: '0.8',
            changefreq: 'weekly'
        }))
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
    res.type('application/xml').send(xml);
});

app.get('/api/posts', (req, res) => {
    let posts = db.posts.filter(p => !p.deleted).sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });
    
    const { search, tag } = req.query;
    if (tag) posts = posts.filter(p => p.tags && p.tags.includes(tag));
    if (search) {
        const s = search.toLowerCase();
        posts = posts.filter(p => p.title.toLowerCase().includes(s) || p.content.toLowerCase().includes(s));
    }
    
    res.json(posts);
});

app.post('/api/admin/posts', isAdmin, upload.array('files'), (req, res) => {
    const { title, content, tags, pinned, published, status, coverImage, attachments } = req.body;
    let media = [];
    if (req.files && req.files.length > 0) {
        media = req.files.map(f => ({ url: `/uploads/${f.filename}`, type: f.mimetype.split('/')[0], name: f.originalname }));
    }
    if (coverImage) {
        media.unshift({ url: coverImage, type: 'image', name: 'cover' });
    }
    if (attachments) {
        try {
            const atts = typeof attachments === 'string' ? JSON.parse(attachments) : attachments;
            atts.forEach(a => media.push(a));
        } catch (e) {}
    }
    const post = {
        id: uuidv4(),
        title,
        content,
        tags: tags ? tags.split(',').map(t => t.trim()) : [],
        pinned: pinned === 'true' || pinned === true,
        published: published !== 'false',
        status: status || 'published',
        media,
        createdAt: new Date().toISOString(),
        views: 0,
        reactions: {},
        comments: [],
        shares: 0
    };
    db.posts.push(post);
    saveDb();
    broadcast({ type: 'new_post', post: { id: post.id, title: post.title } });
    res.json(post);
});

app.put('/api/admin/posts/:id', isAdmin, upload.array('files'), (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    const { title, content, tags, pinned, published, status, coverImage, attachments } = req.body;
    if (title !== undefined) post.title = title;
    if (content !== undefined) post.content = content;
    if (tags !== undefined) post.tags = tags.split(',').map(t => t.trim());
    if (pinned !== undefined) post.pinned = pinned === 'true' || pinned === true;
    if (published !== undefined) post.published = published !== 'false';
    if (status !== undefined) post.status = status;
    if (req.files && req.files.length > 0) {
        req.files.forEach(f => post.media.push({ url: `/uploads/${f.filename}`, type: f.mimetype.split('/')[0], name: f.originalname }));
    }
    if (coverImage) {
        post.media.unshift({ url: coverImage, type: 'image', name: 'cover' });
    }
    if (attachments) {
        try {
            const atts = typeof attachments === 'string' ? JSON.parse(attachments) : attachments;
            atts.forEach(a => post.media.push(a));
        } catch (e) {}
    }
    post.updatedAt = new Date().toISOString();
    saveDb();
    broadcast({ type: 'post_updated', post: { id: post.id, title: post.title } });
    res.json(post);
});

// Quick endpoint to update posts with media (for seeding)
app.post('/api/admin/posts/:id/cover', isAdmin, (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    const { coverImage } = req.body;
    if (coverImage) {
        post.media = [{ url: coverImage, type: 'image', name: 'cover' }];
        saveDb();
    }
    res.json(post);
});

app.delete('/api/admin/posts/:id', isAdmin, (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (post) post.deleted = true;
    saveDb();
    broadcast({ type: 'post_deleted', postId: req.params.id });
    res.json({ success: true });
});

// --- REACTIONS & COMMENTS ---
app.post('/api/posts/:id/react', isUser, (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id && !p.deleted);
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });
    const { emoji = 'like' } = req.body || {};
    if (!post.reactions) post.reactions = {};
    const userId = req.session.userId;
    const current = post.reactions[userId];
    if (current === emoji) {
        // toggle off
        delete post.reactions[userId];
    } else {
        post.reactions[userId] = emoji;
    }
    saveDb();
    // Broadcast to all connected clients
    broadcast({ type: 'reaction', postId: post.id, reactions: post.reactions });
    // Build counts
    const counts = {};
    Object.values(post.reactions).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    res.json({ success: true, reactions: post.reactions, counts, total: Object.keys(post.reactions).length });
});

app.post('/api/posts/:id/share', isUser, (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id && !p.deleted);
    if (!post) return res.status(404).json({ error: 'Post non trouvé' });
    post.shares = (post.shares || 0) + 1;
    saveDb();
    broadcast({ type: 'share', postId: post.id, shares: post.shares });
    res.json({ success: true, shares: post.shares });
});

// Auto-reply logic (Omni-Cortex)
const autoReply = async (postId, comment) => {
    const post = db.posts.find(p => p.id === postId);
    if (!post || comment.userName === 'Omni-Cortex') return;

    // Simple keyword-based AI for now (can be expanded with LLM API)
    let response = "";
    const text = comment.content.toLowerCase();
    
    if (text.includes("merci") || text.includes("bravo") || text.includes("top")) {
        response = `Merci beaucoup ${comment.userName} ! Nous sommes ravis que cela vous plaise. 🍽️`;
    } else if (text.includes("prix") || text.includes("combien") || text.includes("coûte")) {
        response = `Bonjour ${comment.userName}. Pour les tarifs personnalisés, n'hésitez pas à nous contacter directement via le bouton WhatsApp !`;
    } else if (text.includes("où") || text.includes("adresse") || text.includes("lieu")) {
        response = `Nous sommes basés à ${db.settings.location || 'Kinshasa'}. À très bientôt ! 📍`;
    }

    if (response) {
        setTimeout(() => {
            const reply = {
                id: uuidv4(),
                userId: 'ai-nexus',
                userName: 'Administratrice',
                content: response,
                parentId: comment.id,
                createdAt: new Date().toISOString()
            };
            post.comments.push(reply);
            saveDb();
            broadcast({ type: 'new_comment', postId, comment: reply });
        }, 3000); // 3 second delay to feel "natural"
    }
};

app.post('/api/posts/:id/comments', isUser, (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const { content, parentId } = req.body;
    const comment = {
        id: uuidv4(),
        userId: req.session.userId || 'admin',
        userName: req.session.userName || 'Admin',
        content,
        parentId: parentId || null,
        createdAt: new Date().toISOString()
    };
    if (!post.comments) post.comments = [];
    post.comments.push(comment);
    saveDb();
    broadcast({ type: 'new_comment', postId: post.id, comment });
    
    // Trigger Omni-Cortex Auto-Reply
    autoReply(post.id, comment);
    
    res.json(comment);
});

// --- STORIES ---
app.get('/api/stories', (req, res) => {
    const now = new Date();
    const activeStories = db.stories.filter(s => {
        const age = (now - new Date(s.createdAt)) / (1000 * 60 * 60);
        return age < 24 && !s.deleted;
    });
    res.json(activeStories);
});

app.post('/api/admin/stories', isAdmin, upload.single('file'), (req, res) => {
    const { text, bgColor, duration } = req.body;
    const story = {
        id: uuidv4(),
        text,
        bgColor,
        duration: parseInt(duration) || 5,
        mediaUrl: req.file ? `/uploads/${req.file.filename}` : null,
        createdAt: new Date().toISOString(),
        views: 0
    };
    db.stories.push(story);
    saveDb();
    broadcast({ type: 'new_story', story });
    res.json(story);
});

// --- NEWSLETTER ---
app.post('/api/subscribe', (req, res) => {
    const { email, name } = req.body;
    if (db.subscribers.find(s => s.email === email)) return res.status(409).json({ error: 'Already subscribed' });
    db.subscribers.push({ id: uuidv4(), email, name, active: true, createdAt: new Date().toISOString() });
    saveDb();
    res.json({ success: true });
});

// --- ADMIN SETTINGS & STATS ---
app.get('/api/admin/stats', isAdmin, (req, res) => {
    res.json({
        postCount: db.posts.filter(p => !p.deleted).length,
        viewCount: db.posts.reduce((acc, p) => acc + (p.views || 0), 0),
        userCount: db.users.length,
        subscriberCount: db.subscribers.length,
        storyCount: db.stories.length
    });
});

// Public endpoint to read page settings (logo, cover, bio)
app.get('/api/settings', (req, res) => {
    res.json(db.settings);
});

app.post('/api/admin/settings', isAdmin, upload.single('file'), (req, res) => {
    // Body fields + optional file via multer
    const body = { ...req.body };
    // Allow null/empty string to clear a key (only on explicit keys)
    const clearable = ['logoUrl', 'coverUrl', 'category', 'location'];
    clearable.forEach(k => {
        if (body[k] === '' || body[k] === null) delete body[k];
    });
    if (req.file) {
        body.logoUrl = `/uploads/${req.file.filename}`;
    }
    db.settings = { ...db.settings, ...body };
    saveDb();
    res.json({ success: true, settings: db.settings });
});

// Upload just a logo
app.post('/api/admin/settings/logo', isAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    db.settings.logoUrl = `/uploads/${req.file.filename}`;
    saveDb();
    res.json({ success: true, logoUrl: db.settings.logoUrl });
});

// Upload just a cover image
app.post('/api/admin/settings/cover', isAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    db.settings.coverUrl = `/uploads/${req.file.filename}`;
    saveDb();
    res.json({ success: true, coverUrl: db.settings.coverUrl });
});

app.get('/api/admin/settings', isAdmin, (req, res) => res.json(db.settings));

// --- CMS ROUTES ---
app.post('/api/admin/cms/sync', isAdmin, async (req, res) => {
    const { source, config } = req.body;
    try {
        let imported = [];
        if (source === 'wordpress') imported = await CMS.pullWordPress(config);
        if (source === 'ghost') imported = await CMS.pullGhost(config);
        if (source === 'strapi') imported = await CMS.pullStrapi(config);
        if (source === 'notion') imported = await CMS.pullNotion(config);
        
        // Save to DB (Deduplicate)
        imported.forEach(p => {
            if (!db.posts.find(existing => existing.externalId === p.externalId)) {
                db.posts.push({ ...p, id: uuidv4(), reactions: {}, comments: [], views: 0, pinned: false });
            }
        });
        saveDb();
        broadcast({ type: 'cms_sync', source, count: imported.length });
        res.json({ success: true, count: imported.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start Server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
