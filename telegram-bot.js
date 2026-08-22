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
        const match = String(text || '').match(/^\/(publier|brouillon|valider|supprimer|aide|commentaires|valider_commentaire|modifier_commentaire|rejeter_commentaire)(?:@[^\s]+)?\s*([\s\S]*)$/i);
        return match ? { name: match[1].toLowerCase(), args: match[2].trim() } : null;
    }

    function titleContent(value) {
        const lines = String(value || '').split('\n');
        const title = (lines.shift() || '').trim();
        return { title, content: lines.join('\n').trim() };
    }

    async function downloadFile(fileId, uploadDir, type, originalName) {
        const info = await api('getFile', { file_id: fileId });
        if (!info.ok || !info.result?.file_path) throw new Error('Telegram file unavailable');
        const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`);
        if (!response.ok) throw new Error('Telegram download failed');
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = path.extname(originalName || info.result.file_path) || '.bin';
        const filename = `${crypto.randomUUID()}${ext}`;
        fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), buffer);
        return { url: `/uploads/${filename}`, type, name: originalName || filename };
    }

    async function extractMedia(message, uploadDir) {
        if (message.photo?.length) {
            const p = message.photo[message.photo.length - 1];
            return downloadFile(p.file_id, uploadDir, 'image', 'telegram-photo.jpg');
        }
        if (message.video) return downloadFile(message.video.file_id, uploadDir, 'video', message.video.file_name || 'video.mp4');
        if (message.video_note) return downloadFile(message.video_note.file_id, uploadDir, 'video_note', 'video-note.mp4');
        if (message.audio) return downloadFile(message.audio.file_id, uploadDir, 'audio', message.audio.file_name || 'podcast.mp3');
        if (message.voice) return downloadFile(message.voice.file_id, uploadDir, 'audio', 'voice-message.ogg');
        if (message.document) {
            const type = message.document.mime_type === 'application/pdf' ? 'pdf' : 'document';
            return downloadFile(message.document.file_id, uploadDir, type, message.document.file_name || 'document');
        }
        return null;
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
            await send(chatId, 'Commandes Goût Gueule :\n/publier\nTitre\nContenu\n\n/brouillon\nTitre\nContenu\n\n/valider ID\n/supprimer ID\n/commentaires\n/valider_commentaire ID\n/modifier_commentaire ID\nNouveau texte\n/rejeter_commentaire ID');
            return;
        }

        if (parsed.name === 'commentaires') {
            const pending = [];
            for (const post of ctx.db.posts) for (const comment of (post.comments || [])) if (comment.status === 'pending_review') pending.push(`${comment.id.slice(0,8)} — ${post.title}\n${comment.content}`);
            await send(chatId, pending.length ? 'Commentaires en attente :\n\n' + pending.join('\n\n') : 'Aucun commentaire en attente.');
            return;
        }
        if (['valider_commentaire','rejeter_commentaire','modifier_commentaire'].includes(parsed.name)) {
            const lines = parsed.args.split('\n');
            const prefix = (lines.shift() || '').trim().split(/\s+/)[0];
            let found = null;
            for (const post of ctx.db.posts) { const comment = (post.comments || []).find(c => c.id.startsWith(prefix)); if (comment) { found = { post, comment }; break; } }
            if (!found) { await send(chatId, 'Commentaire introuvable.'); return; }
            if (parsed.name === 'valider_commentaire') { found.comment.status = 'approved'; delete found.comment.moderationReason; if (ctx.broadcast) ctx.broadcast({ type: 'new_comment', postId: found.post.id, comment: found.comment }); }
            else if (parsed.name === 'rejeter_commentaire') found.comment.status = 'rejected';
            else { const text = lines.join('\n').trim(); if (!text) { await send(chatId, 'Ajoute le nouveau texte après l’identifiant.'); return; } found.comment.content = text; found.comment.status = 'approved'; }
            ctx.saveDb(); await send(chatId, `✅ Commentaire ${found.comment.status === 'approved' ? 'validé' : 'rejeté'}.`); return;
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
            const item = await extractMedia(message, ctx.uploadDir);
            if (item) media.push(item);
        } catch (error) {
            await send(chatId, 'Le texte est prêt, mais le média n’a pas pu être importé.');
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
