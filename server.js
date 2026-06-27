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
    const { title, content, tags, pinned, published } = req.body;
    const post = {
        id: uuidv4(),
        title,
        content,
        tags: tags ? tags.split(',').map(t => t.trim()) : [],
        pinned: pinned === 'true',
        published: published !== 'false',
        media: req.files.map(f => ({ url: `/uploads/${f.filename}`, type: f.mimetype.split('/')[0], name: f.originalname })),
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

app.delete('/api/admin/posts/:id', isAdmin, (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (post) post.deleted = true;
    saveDb();
    broadcast({ type: 'post_deleted', postId: req.params.id });
    res.json({ success: true });
});

// --- REACTIONS & COMMENTS ---
app.post('/api/posts/:id/react', isUser, (req, res) => {
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const userId = req.session.userId || 'admin';
    const { type } = req.body; // like, love, haha, wow, sad, angry
    
    if (!post.reactions) post.reactions = {};
    if (post.reactions[userId] === type) {
        delete post.reactions[userId];
    } else {
        post.reactions[userId] = type;
    }
    saveDb();
    broadcast({ type: 'reaction_update', postId: post.id, reactions: post.reactions });
    res.json(post.reactions);
});

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

app.post('/api/admin/settings', isAdmin, (req, res) => {
    db.settings = { ...db.settings, ...req.body };
    saveDb();
    res.json({ success: true });
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
