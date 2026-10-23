// Where the page finds the Worker API.
// This is the URL `npm run deploy` prints.
const DEPLOYED_API = 'https://roblox-game-picker.igetigames-363.workers.dev';

window.API_BASE = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8787' // `npm run dev`
  : DEPLOYED_API;
