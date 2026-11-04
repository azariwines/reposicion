// Versión "página de Claude": lee la planilla con el conector de Google Drive del que la abre.
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import Home from '../app/page.js';
import { matrixToObjects, detectColumns, parseDate, extractCombos, parseReporte, STOCK_SCHEMA, SALES_SCHEMA } from '../lib/core.js';

const FILE_ID = '1rIGPovOixvgE7dvaZ7a2p2DFg3geATNv9jXhHnzj7n8';
const SERVER = 'Google Drive';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function fail(msg) { const e = new Error(msg); e.userMessage = msg; return e; }

// Busca el string base64 más largo dentro de la respuesta del conector, venga como venga.
function findBase64(x, best = '') {
  if (typeof x === 'string') {
    if (x.length > best.length && x.length > 500 && /^[A-Za-z0-9+/=\s_-]+$/.test(x.slice(0, 2000))) return x;
    if (x.trim().startsWith('{')) { try { return findBase64(JSON.parse(x), best); } catch {} }
    return best;
  }
  if (Array.isArray(x)) { for (const v of x) best = findBase64(v, best); return best; }
  if (x && typeof x === 'object') { for (const v of Object.values(x)) best = findBase64(v, best); return best; }
  return best;
}

const sheetMatrix = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
const slimRow = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

async function loadFromDrive() {
  const mcp = await window.claude?.use?.('mcp');
  if (!mcp) throw fail('Esta vista no tiene acceso a tu Google Drive. Abrí la página desde claude.ai.');
  let res;
  try {
    res = await mcp.callTool(SERVER, 'download_file_content', {
      fileId: FILE_ID,
      exportMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }, { cache: false });
  } catch (e) {
    const code = e?.code;
    if (code === 'needs_reauth') throw fail('Hay que reconectar Google Drive en claude.ai → Ajustes → Conectores.');
    if (code === 'server_not_connected') throw fail('Agregá el conector de Google Drive en claude.ai → Ajustes → Conectores.');
    if (code === 'not_in_manifest' || code === 'approval_required' || code === 'consent_required') throw fail('La página necesita tu permiso para leer Google Drive. Tocá ↻ y aceptá el permiso.');
    throw fail(`No pude leer la planilla (${code || 'error'}): ${e?.message || ''}`.trim());
  }
  const b64 = findBase64(res?.payload ?? res).replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!b64) throw fail('Google Drive no devolvió el archivo.');
  const wb = XLSX.read(b64, { type: 'base64', cellDates: false });

  const now = new Date();
  const errors = [];
  const y = now.getFullYear();
  const stockName = wb.SheetNames.find((n) => n.trim().toUpperCase() === `STOCK ${y}`)
    || wb.SheetNames.find((n) => /^stock\s*\d{4}$/i.test(n.trim()));
  if (!stockName) throw fail(`No encontré la hoja "STOCK ${y}" en la planilla.`);
  const stockMatrix = sheetMatrix(wb, stockName);
  const combos = extractCombos(stockMatrix);
  const stockObjs = matrixToObjects(stockMatrix, STOCK_SCHEMA)
    .map((o) => slimRow(o, ['BODEGA', 'PRODUCTO', 'UNIDADES POR CAJA', 'STOCK CAJAS']));

  const sales = [];
  const leidas = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(y, now.getMonth() - i, 1);
    const want = `ventas ${MESES[d.getMonth()]} ${d.getFullYear()}`.toLowerCase();
    const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === want);
    if (!name) { errors.push(`No encontré la hoja "Ventas ${MESES[d.getMonth()]} ${d.getFullYear()}"`); continue; }
    leidas.push(MESES[d.getMonth()]);
    const objs = matrixToObjects(sheetMatrix(wb, name), SALES_SCHEMA);
    const { map } = detectColumns(objs, SALES_SCHEMA);
    for (const o of objs) {
      const f = parseDate(o[map.fecha]);
      if (!f || f.getMonth() !== d.getMonth() || f.getFullYear() !== d.getFullYear()) continue;
      sales.push({ FECHA: f.toISOString(), PRODUCTO: o[map.producto] ?? '', CANTIDAD: map.cantidad ? o[map.cantidad] : '' });
    }
  }

  // Ranking del mes pasado desde la hoja "Reporte <Mes> <Año>"
  let ranking = null;
  const pm = new Date(y, now.getMonth() - 1, 1);
  const repName = wb.SheetNames.find((n) => n.trim().toLowerCase() === `reporte ${MESES[pm.getMonth()]} ${pm.getFullYear()}`.toLowerCase());
  if (repName) {
    const items = parseReporte(sheetMatrix(wb, repName));
    if (items.length) ranking = { mes: MESES[pm.getMonth()].toLowerCase(), items };
  } else errors.push(`No encontré la hoja "Reporte ${MESES[pm.getMonth()]} ${pm.getFullYear()}" (ranking de ventas)`);

  return {
    at: new Date().toISOString(),
    ranking,
    stock: { type: 'objects', data: stockObjs },
    combos,
    sales: { type: 'objects', data: sales },
    stockSource: `Planilla · ${stockName}`,
    salesSource: `Planilla · ${leidas.join(', ')}`,
    errors,
  };
}

window.__AZARI_LOADER__ = loadFromDrive;
window.__AZARI_REFRESH_MS__ = 5 * 60 * 1000; // en esta versión baja el archivo entero: cada 5 min + botón ↻

createRoot(document.getElementById('root')).render(<Home />);
