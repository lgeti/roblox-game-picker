// Roblox Game Picker API, running on Cloudflare Workers.
// All games live in one Durable Object ("main"), so every request sees the same list
// and saves never clobber each other. The page itself is hosted on GitHub Pages.
import { DurableObject } from 'cloudflare:workers';

// ---------- Roblox lookup ----------

// Accepts links like https://www.roblox.com/games/920587237/Adopt-Me
// (with or without www / language prefix), ?placeId=123 links, or a bare place ID.
function parsePlaceId(input) {
  const text = String(input || '').trim();
  if (/^\d+$/.test(text)) return text;
  let url;
  try {
    url = new URL(text.startsWith('http') ? text : 'https://' + text);
  } catch {
    return null;
  }
  if (!/(^|\.)roblox\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/games\/(\d+)/i);
  if (match) return match[1];
  const placeId = url.searchParams.get('placeId') || url.searchParams.get('placeid');
  if (placeId && /^\d+$/.test(placeId)) return placeId;
  return null;
}

function nameFromSlug(input) {
  const match = String(input).match(/\/games\/\d+\/([^/?#]+)/i);
  if (!match) return null;
  return decodeURIComponent(match[1]).replace(/-/g, ' ');
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function lookupRobloxGame(placeId) {
  const { universeId } = await getJson(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
  if (!universeId) throw new Error('No universe for place ' + placeId);

  const [details, icons] = await Promise.all([
    getJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
    getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=256x256&format=Png&isCircular=false`).catch(() => null),
  ]);

  const game = details.data && details.data[0];
  if (!game) throw new Error('No game details for universe ' + universeId);

  return {
    universeId,
    name: game.name,
    creator: game.creator && game.creator.name,
    description: (game.description || '').slice(0, 300),
    playing: game.playing,
    visits: game.visits,
    maxPlayers: game.maxPlayers,
    icon: icons && icons.data && icons.data[0] ? icons.data[0].imageUrl : null,
  };
}

// ---------- helpers ----------

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 30);
}

// ---------- storage: one Durable Object holds the whole list ----------

export class GameList extends DurableObject {
  async getGames() {
    return (await this.ctx.storage.get('games')) || [];
  }

  async saveGames(games) {
    await this.ctx.storage.put('games', games);
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    let games = await this.getGames();

    // GET /api/games
    if (request.method === 'GET' && pathname === '/api/games') {
      return json(200, games);
    }

    // POST /api/games  { url, addedBy, note }
    if (request.method === 'POST' && pathname === '/api/games') {
      const body = await readBody(request);
      const addedBy = cleanName(body.addedBy);
      if (!addedBy) return json(400, { error: 'Tell us your name first.' });

      const placeId = parsePlaceId(body.url);
      if (!placeId) return json(400, { error: "That doesn't look like a Roblox game link." });

      const existing = games.find((g) => g.placeId === placeId);
      if (existing) return json(409, { error: `"${existing.name}" is already on the list.` });

      let info = {};
      try {
        info = await lookupRobloxGame(placeId);
      } catch (err) {
        console.warn('Roblox lookup failed:', err.message);
      }

      // Re-read in case someone else added the same game during the lookup.
      games = await this.getGames();
      if (games.some((g) => g.placeId === placeId)) return json(409, { error: 'That game is already on the list.' });

      const game = {
        id: crypto.randomUUID(),
        placeId,
        url: `https://www.roblox.com/games/${placeId}`,
        name: info.name || nameFromSlug(body.url) || `Game ${placeId}`,
        creator: info.creator || null,
        description: info.description || '',
        icon: info.icon || null,
        playing: info.playing ?? null,
        visits: info.visits ?? null,
        maxPlayers: info.maxPlayers ?? null,
        note: String(body.note || '').trim().slice(0, 140),
        addedBy,
        addedAt: new Date().toISOString(),
        votes: [addedBy],
        played: false,
      };
      games.push(game);
      await this.saveGames(games);
      return json(201, game);
    }

    const match = pathname.match(/^\/api\/games\/([\w-]+)(?:\/(vote|played))?$/);
    if (!match) return json(404, { error: 'Not found' });
    const game = games.find((g) => g.id === match[1]);
    if (!game) return json(404, { error: 'Game not found' });
    const action = match[2];

    // POST /api/games/:id/vote  { name }  -> toggles that person's vote
    if (request.method === 'POST' && action === 'vote') {
      const { name } = await readBody(request);
      const voter = cleanName(name);
      if (!voter) return json(400, { error: 'Tell us your name first.' });
      game.votes = game.votes.includes(voter) ? game.votes.filter((v) => v !== voter) : [...game.votes, voter];
      await this.saveGames(games);
      return json(200, game);
    }

    // POST /api/games/:id/played  -> toggles played
    if (request.method === 'POST' && action === 'played') {
      game.played = !game.played;
      await this.saveGames(games);
      return json(200, game);
    }

    // DELETE /api/games/:id
    if (request.method === 'DELETE' && !action) {
      await this.saveGames(games.filter((g) => g.id !== game.id));
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  }
}

// ---------- entry point ----------

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(request.url);
    let response;
    if (pathname.startsWith('/api/')) {
      try {
        const stub = env.GAME_LIST.get(env.GAME_LIST.idFromName('main'));
        response = await stub.fetch(request);
      } catch (err) {
        console.error(err);
        response = json(500, { error: 'Something went wrong' });
      }
    } else {
      response = json(200, { ok: true, message: 'Roblox Game Picker API. The page lives on GitHub Pages.' });
    }

    response = new Response(response.body, response);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  },
};
