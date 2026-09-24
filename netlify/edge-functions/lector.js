/**
 * Lector de enlaces para el Gestor APA 7 — Netlify Edge Function
 *
 * Trae una página (HTML o PDF) a pedido del Gestor, que después lee los
 * metadatos en el navegador. Solo transporta: no guarda nada.
 *
 * Se publica sola junto con el sitio y responde en:
 *   https://tu-sitio.netlify.app/api/lector?url=https://ejemplo.com/pagina
 *
 * Como la página y el lector están en el mismo sitio, no hace falta
 * configurar nada. Variable opcional (Project configuration → Environment variables):
 *   ORIGENES = https://otrositio.com   → otros sitios que también pueden usarlo
 */
const LIMITE = 50 * 1024 * 1024; // 50 MB
const PRIVADAS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[|metadata\.)/i;
const NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ---------- YouTube: título y canal por oEmbed, fecha desde la página o la API interna ---------- */
const idDeYouTube = u => (u.match(/[?&]v=([\w-]{11})/) || u.match(/youtu\.be\/([\w-]{11})/) || u.match(/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1];
const COOKIES_YT = 'CONSENT=YES+cb.20240101-00-p0.es+FX+000; SOCS=CAI';
const fechaYT = t => {
  const m = t.match(/"publishDate":"(\d{4}-\d{2}-\d{2})/) || t.match(/itemprop="datePublished" content="(\d{4}-\d{2}-\d{2})/)
    || t.match(/"uploadDate":"(\d{4}-\d{2}-\d{2})/) || t.match(/itemprop="uploadDate" content="(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
async function leerYouTube(url) {
  const id = idDeYouTube(url);
  if (!id) return null;
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const datos = { tipo: 'youtube', url: watch, titulo: '', canal: '', fecha: null, fuentes: [] };

  // 1) oEmbed: la vía oficial y estable para título y canal
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, { headers: { 'User-Agent': NAVEGADOR } });
    if (r.ok) { const j = await r.json(); datos.titulo = j.title || ''; datos.canal = j.author_name || ''; datos.fuentes.push('oembed'); }
    else if (r.status === 401 || r.status === 403) datos.aviso = 'El video es privado o no permite insertarse.';
    else if (r.status === 404 || r.status === 400) return { ...datos, error: 'Ese video no existe o fue eliminado.' };
  } catch {}

  // 2) Página del video: la fecha de publicación
  try {
    const r = await fetch(`${watch}&hl=es&persist_hl=1&bpctr=9999999999&has_verified=1&ucbcb=1`, {
      headers: { 'User-Agent': NAVEGADOR, 'Accept-Language': 'es-UY,es;q=0.9,en;q=0.7', 'Cookie': COOKIES_YT },
    });
    if (r.ok) {
      const html = await r.text();
      datos.fecha = fechaYT(html);
      if (!datos.titulo) { const m = html.match(/<meta name="title" content="([^"]+)"/); if (m) datos.titulo = decodificar(m[1]); }
      if (!datos.canal) { const m = html.match(/<link itemprop="name" content="([^"]+)"/) || html.match(/"ownerChannelName":"([^"]+)"/); if (m) datos.canal = decodificar(m[1]); }
      if (datos.fecha) datos.fuentes.push('página');
    }
  } catch {}

  // 3) Si la página no dio la fecha (bloqueo o consentimiento), API interna del reproductor
  if (!datos.fecha) {
    try {
      const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'User-Agent': NAVEGADOR, 'Content-Type': 'application/json', 'Cookie': COOKIES_YT, 'Origin': 'https://www.youtube.com' },
        body: JSON.stringify({ videoId: id, context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'es', gl: 'UY' } } }),
      });
      if (r.ok) {
        const j = await r.json();
        const mf = (j.microformat || {}).playerMicroformatRenderer || {};
        const f = (mf.publishDate || mf.uploadDate || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(f)) { datos.fecha = f; datos.fuentes.push('reproductor'); }
        const vd = j.videoDetails || {};
        if (!datos.titulo && vd.title) datos.titulo = vd.title;
        if (!datos.canal && (vd.author || mf.ownerChannelName)) datos.canal = vd.author || mf.ownerChannelName;
      }
    } catch {}
  }
  return datos;
}
const decodificar = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export default async (request) => {
  const propio = new URL(request.url).origin;
  const origen = request.headers.get('Origin');
  const extra = (Netlify.env.get('ORIGENES') || '').split(',').map(s => s.trim()).filter(Boolean);
  const permitido = !origen || origen === propio || extra.includes('*') || extra.includes(origen);
  const cors = origen && permitido && origen !== propio
    ? { 'Access-Control-Allow-Origin': origen, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Type, X-Url-Final', 'Vary': 'Origin' }
    : {};
  const error = (msg, status = 400) =>
    new Response(msg, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!permitido) return error('Este lector no acepta pedidos desde ese sitio.', 403);
  if (request.method !== 'GET') return error('Solo se aceptan pedidos GET.', 405);

  let destino;
  try { destino = new URL(new URL(request.url).searchParams.get('url')); }
  catch { return error('Falta la dirección a leer (?url=...).'); }
  if (!/^https?:$/.test(destino.protocol) || PRIVADAS.test(destino.hostname)) return error('Esa dirección no está permitida.');

  // Videos de YouTube: respuesta propia en JSON
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(destino.hostname)) {
    const yt = await leerYouTube(destino.toString());
    if (!yt) return error('No reconozco ese enlace de YouTube. Copia la dirección del video desde el botón Compartir.');
    if (yt.error) return error(yt.error, 404);
    if (!yt.titulo && !yt.canal) return error('YouTube no entregó los datos de ese video. Prueba de nuevo en unos minutos.', 502);
    return new Response(JSON.stringify(yt), { status: 200, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'X-Url-Final': yt.url, 'Cache-Control': 'public, max-age=3600' } });
  }

  const cabeceras = {
    'User-Agent': NAVEGADOR,
    'Accept': 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
    'Accept-Language': 'es-UY,es;q=0.9,en;q=0.7',
  };

  let r;
  try { r = await fetch(destino.toString(), { redirect: 'follow', headers: cabeceras }); }
  catch { return error('No se pudo conectar con ese sitio.', 502); }
  if (!r.ok) return error(`El sitio respondió con el código ${r.status}. Puede que bloquee lectores automáticos: sube el PDF o pega el código fuente.`, 502);
  const largo = +r.headers.get('Content-Length') || 0;
  if (largo > LIMITE) return error('El archivo supera los 50 MB.', 413);

  const cabecerasRespuesta = {
    ...cors,
    'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream',
    'X-Url-Final': r.url,
    'Cache-Control': 'public, max-age=3600',
  };
  // Tamaño conocido: se reenvía directo, sin gastar tiempo de CPU de la función
  if (largo) return new Response(r.body, { status: 200, headers: cabecerasRespuesta });

  // Tamaño desconocido: se reenvía por partes y se corta si pasa el límite
  let enviados = 0;
  const corte = new TransformStream({
    transform(parte, ctrl) {
      enviados += parte.byteLength;
      if (enviados > LIMITE) ctrl.error(new Error('El archivo supera los 50 MB.'));
      else ctrl.enqueue(parte);
    },
  });
  return new Response(r.body.pipeThrough(corte), { status: 200, headers: cabecerasRespuesta });
};

export const config = { path: '/api/lector' };
