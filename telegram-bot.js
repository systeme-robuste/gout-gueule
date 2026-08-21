// Telegram publisher for Goût Gueule.
// Only TELEGRAM_ADMIN_ID may execute editorial commands.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function makeTelegram(botToken) {
    const api = (method, body) => fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    }).then(r => r.json());

    const send = (chatId, text) => api('sendMessage', { chat_id: chatId, text });

    function isAdmin(update) {
        const id = update?.message?.from?.id ?? update?.message?.chat?.id;
        return String(id) === String(process.env.TELEGRAM_ADMIN_ID || '');
    }

    function command(text) {
        const match = String(text || '').match(/^\/(publier|brouillon|valider|supprimer|aide)(?:@[^\s]+)?\s*([\s\S]*)$/i);
        return match ? { name: match[1].toLowerCase(), args: match[2].trim() } : null;
    }

    function titleContent(value) {
        const lines = String(value || '').split('\n');
        const title = (lines.shift() || '').trim();
        return { title, content: lines.join('\n').trim() };
    }

    async function downloadPhoto(fileId, uploadDir) {
        const info = await api('getFile', { file_id: fileId });
        if (!info.ok || !info.result?.file_path) throw new Error('Telegram file unavailable');
        const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`);
        if (!response.ok) throw new Error('Telegram download failed');
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = path.extname(info.result.file_path) || '.jpg';
        const filename = `${crypto.randomUUID()}${ext}`;
        fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), buffer);
        return { url: `/uploads/${filename}`, type: 'image', name: filename };
    }

    async function handle(update, ctx) {
        const message = update?.message;
        if (!message?.chat?.id) return;
        const chatId = message.chat.id;
        const parsed = command(message.text || message.caption || '');
        if (!parsed) return;
        if (!isAdmin(update)) {
            await send(chatId, 'Accès refusé. Ce bot est réservé à son administrateur.');
            return;
        }

        if (parsed.name === 'aide') {
            await send(chatId, 'Commandes Goût Gueule :\n/publier\nTitre\nContenu\n\n/brouillon\nTitre\nContenu\n\n/valider ID\n/supprimer ID');
            return;
        }

        if (parsed.name === 'valider' || parsed.name === 'supprimer') {
            const prefix = parsed.args.split(/\s+/)[0];
            const post = ctx.db.posts.find(p => !p.deleted && p.id.startsWith(prefix));
            if (!post) { await send(chatId, 'Article introuvable. Vérifie son identifiant.'); return; }
            if (parsed.name === 'supprimer') {
                post.deleted = true;
                post.deletedAt = new Date().toISOString();
                ctx.saveDb();
                await send(chatId, `Article supprimé : ${post.title}`);
            } else {
                post.published = true;
                post.status = 'published';
                ctx.saveDb();
                await send(chatId, `Article publié : ${post.title}`);
            }
            return;
        }

        const { title, content } = titleContent(parsed.args || message.caption || '');
        if (!title || !content) {
            await send(chatId, `Format attendu :\n/${parsed.name}\nTitre de l'article\nContenu de l'article`);
            return;
        }

        const media = [];
        try {
            const photos = message.photo;
            if (photos?.length) media.push(await downloadPhoto(photos[photos.length - 1].file_id, ctx.uploadDir));
        } catch (error) {
            await send(chatId, 'Le texte est prêt, mais l’image n’a pas pu être importée.');
        }

        const now = new Date().toISOString();
        const post = {
            id: crypto.randomUUID(), title, content, tags: [], pinned: false,
            published: parsed.name === 'publier',
            status: parsed.name === 'publier' ? 'published' : 'draft',
            media, createdAt: now, views: 0, reactions: {}, comments: [], shares: 0,
            source: 'telegram', telegramChatId: String(chatId)
        };
        ctx.db.posts.push(post);
        ctx.saveDb();
        if (ctx.broadcast) ctx.broadcast({ type: 'new_post', post: { id: post.id, title: post.title } });
        const state = post.published ? 'publié' : 'enregistré comme brouillon';
        await send(chatId, `✅ Article ${state}.\n\n${post.title}\nID : ${post.id}`);
    }

    return { handle };
}

module.exports = makeTelegram;
