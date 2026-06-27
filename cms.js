const fetch = require('node-fetch');
const TurndownService = require('turndown');
const xml2js = require('xml2js');
const { v4: uuidv4 } = require('uuid');

const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
});

const CMS = {
    // WordPress
    async pullWordPress(config) {
        const { url, username, appPassword, perPage = 10 } = config;
        const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
        const res = await fetch(`${url}/wp-json/wp/v2/posts?per_page=${perPage}&_embed`, {
            headers: { 'Authorization': `Basic ${auth}` }
        });
        const posts = await res.json();
        return posts.map(p => ({
            externalId: p.id.toString(),
            source: 'wordpress',
            title: p.title.rendered,
            content: turndown.turndown(p.content.rendered),
            tags: p._embedded?.['wp:term']?.[1]?.map(t => t.name) || [],
            media: p._embedded?.['wp:featuredmedia']?.[0]?.source_url ? 
                   [{ url: p._embedded['wp:featuredmedia'][0].source_url, type: 'image' }] : [],
            createdAt: p.date,
            externalUrl: p.link
        }));
    },

    // Ghost
    async pullGhost(config) {
        const { url, apiKey } = config;
        const res = await fetch(`${url}/ghost/api/content/posts/?key=${apiKey}&include=tags,authors`);
        const { posts } = await res.json();
        return posts.map(p => ({
            externalId: p.id,
            source: 'ghost',
            title: p.title,
            content: turndown.turndown(p.html),
            tags: p.tags?.map(t => t.name) || [],
            media: p.feature_image ? [{ url: p.feature_image, type: 'image' }] : [],
            createdAt: p.created_at,
            externalUrl: p.url
        }));
    },

    // Strapi
    async pullStrapi(config) {
        const { url, apiToken, contentType, titleField, bodyField } = config;
        const res = await fetch(`${url}/api/${contentType}?populate=*`, {
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        const { data } = await res.json();
        return data.map(item => {
            const attr = item.attributes;
            return {
                externalId: item.id.toString(),
                source: 'strapi',
                title: attr[titleField],
                content: turndown.turndown(attr[bodyField]),
                tags: attr.tags?.data?.map(t => t.attributes.name) || [],
                createdAt: attr.createdAt,
                media: [] // Media handling for Strapi varies
            };
        });
    },

    // Notion
    async pullNotion(config) {
        const { integrationToken, databaseId } = config;
        const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${integrationToken}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            }
        });
        const { results } = await res.json();
        // Simplified Notion parsing
        return results.map(p => ({
            externalId: p.id,
            source: 'notion',
            title: p.properties.Name?.title?.[0]?.plain_text || 'Untitled',
            content: "Notion content pull requires block-by-block fetching (simplified here).",
            createdAt: p.created_time,
            externalUrl: p.url
        }));
    },

    // XML WordPress Import
    async importWXR(xmlString) {
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlString);
        const items = result.rss.channel.item;
        const posts = Array.isArray(items) ? items : [items];
        return posts
            .filter(i => i['wp:post_type'] === 'post')
            .map(i => ({
                externalId: i['wp:post_id'],
                source: 'wordpress_xml',
                title: i.title,
                content: turndown.turndown(i['content:encoded'] || ''),
                createdAt: new Date(i.pubDate).toISOString(),
                tags: [] // Tags in WXR are in category tags
            }));
    }
};

module.exports = CMS;
