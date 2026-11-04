// ===================== Normalización =====================
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
// Clave para cruzar stock con ventas: sin tildes, sin signos, sin añadas.
export function keyName(s) {
  return norm(s).replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
}
export function cleanBodega(b) {
  let s = String(b || '').trim().replace(/^bodega(s)?\s+/i, '').replace(/\s*\((nueva|nuevo)\)\s*$/i, '');
  if (s && s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/(^|[\s(\-\/])(\p{L})/gu, (m, a, c) => a + c.toUpperCase()).replace(/\s(Y|De|Del|La|Los)\s/g, (m) => m.toLowerCase());
  }
  return s || 'Sin bodega';
}
export function cellStr(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(cellStr).join(', ');
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return v.name ?? v.text ?? JSON.stringify(v);
  return String(v);
}
export function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = cellStr(v).trim();
  if (/^(si|sí|yes|hay)$/i.test(s)) return 'SI';
  if (/^(no|sin stock|agotado)$/i.test(s)) return 0;
  s = s.replace(/[^\d,.\-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // serial de Excel -> fecha local al mediodía (evita corrimientos por zona horaria)
      const u = new Date(Math.round((v - 25569) * 864e5));
      return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12);
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); // dd/mm/aaaa
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1], 12);
    return isNaN(d) ? null : d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// ===================== Detección de columnas =====================
const PRODUCTO = ['producto', 'productos', 'etiqueta', 'vino', 'descripcion', 'articulo', 'nombre', 'item', 'product', 'detalle'];
const BODEGA = ['bodega', 'marca', 'proveedor', 'brand', 'fabricante'];

export const STOCK_SCHEMA = {
  producto: { label: 'Producto', aliases: PRODUCTO, required: true },
  bodega: { label: 'Bodega', aliases: BODEGA },
  stockCajas: { label: 'Stock en cajas', aliases: ['stock cajas', 'cajas en stock', 'cajas disponibles', 'cajas'] },
  stock: { label: 'Stock (botellas)', aliases: ['stock', 'stock actual', 'existencia', 'existencias', 'disponible', 'stock botellas', 'stock unidades', 'cantidad', 'saldo'] },
  porCaja: { label: 'Botellas por caja', aliases: ['unidades por caja', 'botellas por caja', 'u x caja', 'x caja', 'unidades', 'presentacion', 'bultos'] },
};
export const SALES_SCHEMA = {
  fecha: { label: 'Fecha', aliases: ['fecha', 'fecha venta', 'fecha de venta', 'date', 'dia', 'created', 'creado'], required: true },
  producto: { label: 'Producto', aliases: PRODUCTO, required: true },
  cantidad: { label: 'Cantidad', aliases: ['cantidad', 'cant', 'unidades', 'botellas', 'qty', 'cajas', 'cantidad vendida'] },
  bodega: { label: 'Bodega', aliases: BODEGA },
};

function findCol(headers, aliases, used) {
  const H = headers.map((h) => ({ h, n: norm(h) }));
  for (const a of aliases) {
    const f = H.find((x) => x.n === a && !used.has(x.h));
    if (f) { used.add(f.h); return f.h; }
  }
  for (const a of aliases) {
    const f = H.find((x) => x.n && (x.n.startsWith(a + ' ') || x.n.endsWith(' ' + a) || x.n.includes(' ' + a + ' ')) && !used.has(x.h));
    if (f) { used.add(f.h); return f.h; }
  }
  return null;
}

export function detectColumns(rows, schema, overrides = {}) {
  const headers = Array.from(new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))).filter((h) => h && !h.startsWith('__'));
  const used = new Set(Object.values(overrides).filter(Boolean));
  const map = {};
  for (const [k, def] of Object.entries(schema)) {
    if (overrides[k] && headers.includes(overrides[k])) map[k] = overrides[k];
    else if (overrides[k] === '__none') map[k] = null;
    else map[k] = findCol(headers, def.aliases, used);
  }
  return { map, headers };
}

// Convierte una matriz (filas de celdas) en objetos, buscando la fila de encabezados
// aunque el archivo tenga títulos arriba.
// Formato de la hoja STOCK de Azari: sin encabezados; filas título ("BODEGA CATENA ZAPATA")
// y debajo: A = producto, B = botellas por caja, C = cajas en stock (el resto: costos, se ignora).
// ---------- Reporte mensual (tabla dinámica "Etiqueta | SUM de Cantidad") ----------
const NO_ETIQUETA = /bonificad|costo de env|^suma total|^total/i;
export function parseReporte(matrix) {
  for (let r = 0; r < Math.min(matrix.length, 30); r++) {
    const row = matrix[r] || [];
    const c = row.findIndex((v) => norm(cellStr(v)) === 'etiqueta');
    if (c < 0) continue;
    let q = row.findIndex((v, i) => i > c && /cantidad/i.test(cellStr(v)));
    if (q < 0) q = c + 1;
    const out = [];
    for (let i = r + 1; i < matrix.length; i++) {
      const name = cellStr(matrix[i]?.[c]).replace(/^[^\p{L}\p{N}]+/u, '').trim();
      if (!name) continue;
      if (/^suma total/i.test(name)) break;
      const n = parseNum(matrix[i][q]);
      if (NO_ETIQUETA.test(name) || typeof n !== 'number' || n <= 0) continue;
      out.push({ producto: name, cantidad: n });
    }
    out.sort((a, b) => b.cantidad - a.cantidad);
    return out;
  }
  return [];
}

// ---------- Combos (Recomendadas, Essentials, Signature, Mystery Box) ----------
const COMBO_GRUPOS = [
  ['Recomendadas', /^recomendad/i],
  ['Essentials', /^combo\s+essential/i],
  ['Signature', /^azari\s+signature/i],
  ['Mystery Box', /^mystery\s*box/i],
];
const ITEM_PREFIX = /^(R\d+|ES\d+|AS\d*|M\d+)\s+(?=\S)/i;
const SECCION_IGNORADA = /seguimiento|costo de env|bonificad/i;

export const comboGrupo = (a) => (COMBO_GRUPOS.find(([, re]) => re.test(a)) || [null])[0];

// Saca los combos de la hoja STOCK: fila título del combo + filas "R1 Etiqueta", "ES1 Etiqueta", etc.
export function extractCombos(matrix) {
  const combos = [];
  let cur = null;
  for (const row of matrix) {
    const a = cellStr(row?.[0]).trim();
    if (!a) continue;
    const grupo = comboGrupo(a);
    if (grupo) {
      const [nombre, ...rest] = a.split(':');
      const c = parseNum(row[2]);
      cur = { id: keyName(nombre), grupo, nombre: nombre.trim(), detalle: rest.join(':').trim().replace(/\.$/, ''), armadas: typeof c === 'number' ? c : 0, items: [] };
      combos.push(cur);
      continue;
    }
    if (cur && ITEM_PREFIX.test(a)) { cur.items.push(a.replace(ITEM_PREFIX, '').replace(/^[^\p{L}\p{N}]+/u, '').trim()); continue; }
    cur = null;
  }
  return combos.filter((c) => c.items.length);
}

// Formato de la hoja STOCK de Azari: sin encabezados; filas título ("BODEGA CATENA ZAPATA")
// y debajo: A = producto, B = botellas por caja, C = cajas en stock (el resto: costos, se ignora).
export function azariStockLayout(matrix) {
  const out = [];
  let bodega = '';
  let enCombo = false;
  for (const row of matrix) {
    const a = cellStr(row?.[0]).trim();
    if (!a) continue;
    const b = parseNum(row[1]);
    const c = parseNum(row[2]);
    const bNum = typeof b === 'number' && b > 0;
    const cNum = typeof c === 'number';
    if (/^total/i.test(a)) continue;
    // Los combos van aparte (extractCombos): no son etiquetas para pedir a una bodega.
    if (comboGrupo(a)) { enCombo = true; continue; }
    if (enCombo && ITEM_PREFIX.test(a)) continue;
    enCombo = false;
    // Título de bodega o categoría: tiene nombre pero no tiene stock en C
    // ("Whisky & Espumantes Importados" trae un 6 en B, por eso se mira C).
    if (!cNum) { bodega = a; continue; }
    if (SECCION_IGNORADA.test(bodega)) continue;
    out.push({ BODEGA: bodega, PRODUCTO: a, 'UNIDADES POR CAJA': bNum ? b : '', 'STOCK CAJAS': c });
  }
  return out;
}

// Busca la etiqueta del combo en el stock: primero por nombre exacto, después por palabras en común.
function lev1(a, b) { // ¿distancia de edición <= 1? (tolera un error de tipeo)
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}
function matchProduct(label, products, byKey) {
  const k = keyName(label);
  if (byKey.has(k)) return byKey.get(k);
  const toks = k.split(' ').filter((t) => t.length > 1);
  let best = null, score = 0, diff = 99;
  for (const p of products) {
    const pt = p.key.split(' ').filter((t) => t.length > 1);
    let inter = 0;
    for (const t of toks) if (pt.some((u) => lev1(t, u))) inter++;
    const sc = inter / Math.max(toks.length, pt.length);
    const df = Math.abs(toks.length - pt.length);
    if (sc > score || (sc === score && df < diff)) { score = sc; best = p; diff = df; }
  }
  return score >= 0.6 ? best : null;
}

export function computeCombos(combos, products) {
  const byKey = new Map();
  for (const p of products) if (!byKey.has(p.key)) byKey.set(p.key, p);
  return combos.map((c) => {
    const need = new Map();
    for (const it of c.items) { const k = keyName(it); need.set(k, { label: it, n: (need.get(k)?.n || 0) + 1 }); }
    const items = [...need.values()].map(({ label, n }) => {
      const p = matchProduct(label, products, byKey);
      let estado = 'nf';
      if (p) estado = !p.stockKnown || p.stockU < n ? 'falta' : p.cajas < 1 ? 'poco' : 'ok';
      return { label, n, p, estado, posibles: p ? Math.floor(p.stockU / n) : 0 };
    });
    const posibles = items.length ? Math.min(...items.map((i) => i.posibles)) : 0;
    const faltan = items.filter((i) => i.estado !== 'ok');
    return { ...c, items, posibles, faltan, completo: faltan.length === 0 };
  });
}

export function matrixToObjects(matrix, schema) {
  const allAliases = Object.values(schema).flatMap((d) => d.aliases);
  let hi = 0, best = -1;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const cells = (matrix[i] || []).map((c) => norm(cellStr(c)));
    const score = cells.filter((c) => c && allAliases.some((a) => c === a || c.startsWith(a + ' '))).length;
    if (score > best) { best = score; hi = i; }
  }
  if (schema === STOCK_SCHEMA && best < 2) return azariStockLayout(matrix);
  const header = (matrix[hi] || []).map((c, i) => cellStr(c).trim() || `Columna ${i + 1}`);
  const out = [];
  for (let i = hi + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((c) => c === '' || c == null)) continue;
    const o = {};
    header.forEach((h, j) => { o[h] = row[j] ?? ''; });
    out.push(o);
  }
  return out;
}

// ===================== Parseo =====================
export function parseStock(rows, { overrides = {}, stockUnit = 'botellas', defaultPorCaja = 6 } = {}) {
  const { map, headers } = detectColumns(rows, STOCK_SCHEMA, overrides);
  const items = new Map();
  let lastBodega = '';
  for (const r of rows) {
    const producto = cellStr(r[map.producto]).replace(/^[^\p{L}\p{N}]+/u, '').trim();
    const bRaw = map.bodega ? cellStr(r[map.bodega]).trim() : '';
    if (bRaw) lastBodega = bRaw; // soporta hojas donde la bodega aparece solo en la primera fila del bloque
    if (!producto || /^total/i.test(producto)) continue;
    const pcRaw = map.porCaja ? parseNum(r[map.porCaja]) : null;
    const porCaja = typeof pcRaw === 'number' && pcRaw > 0 ? pcRaw : defaultPorCaja;
    let stockU = null, known = true;
    if (map.stockCajas) {
      const c = parseNum(r[map.stockCajas]);
      if (typeof c === 'number') stockU = c * porCaja;
    }
    if (stockU == null && map.stock) {
      const s = parseNum(r[map.stock]);
      if (s === 'SI') known = false;
      else if (typeof s === 'number') stockU = stockUnit === 'cajas' ? s * porCaja : s;
    }
    const bodega = cleanBodega(bRaw || lastBodega);
    const id = keyName(bodega + ' ' + producto);
    const prev = items.get(id);
    if (prev) { prev.stockU += stockU || 0; prev.stockKnown = prev.stockKnown || known; continue; }
    items.set(id, { id, key: keyName(producto), producto, bodega, porCaja, stockU: Math.max(0, stockU || 0), stockKnown: known && stockU != null });
  }
  return { items: [...items.values()], map, headers };
}

export function parseSales(rows, { overrides = {} } = {}) {
  const { map, headers } = detectColumns(rows, SALES_SCHEMA, overrides);
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const date = parseDate(r[map.fecha]);
    const producto = cellStr(r[map.producto]).trim();
    if (!date || !producto) { skipped++; continue; }
    const q = map.cantidad ? parseNum(r[map.cantidad]) : 1;
    if (map.cantidad && (q == null || q === 0)) { skipped++; continue; }
    if (/costo de env|^env[ií]o/i.test(producto)) { skipped++; continue; }
    const qty = typeof q === 'number' ? q : 1;
    // Un registro puede traer varios productos separados por coma ("Nicasia Malbec, Enemigo Malbec")
    const parts = producto.includes(',') && !/\d,\d/.test(producto) ? producto.split(',').map((x) => x.trim()).filter(Boolean) : [producto];
    const esCombo = parts.length > 1 || /^combo|^box|^estuche/i.test(producto);
    for (let p of parts) {
      p = p.replace(/^[^:]{0,40}:\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[.\s…]+$/, ''); // "Combo X: Nicasia Malbec" -> "Nicasia Malbec"
      // en un combo cada vino es 1 botella por combo vendido
      out.push({ date, key: keyName(p.replace(/\s*x\s*\d+$/i, '')), producto: p, qty, botella: esCombo && parts.length > 1 });
    }
  }
  return { sales: out, map, headers, skipped };
}

// ===================== Modelo de reposición =====================
export const ESTADOS = {
  urgente: { rank: 0, label: 'Urgente', hint: 'En 0 y se vendió el último mes' },
  agotado: { rank: 1, label: 'Agotado', hint: 'Stock en 0' },
  critico: { rank: 2, label: 'Menos de 1 caja', hint: '' },
  bajo: { rank: 3, label: 'Bajo', hint: 'Debajo del mínimo de cajas' },
  'se-acaba': { rank: 4, label: 'Se acaba pronto', hint: 'Al ritmo de venta, no llega a la cobertura de alerta' },
  ok: { rank: 5, label: 'OK', hint: '' },
  'sin-dato': { rank: 6, label: 'Sin dato', hint: 'El stock no es numérico' },
};
export const A_REPONER = new Set(['urgente', 'agotado', 'critico', 'bajo', 'se-acaba']);

export function buildModel(stockItems, sales, settings, openOrders = {}, ranking = null) {
  const { umbralCajas = 2, coberturaDias = 30, alertaDias = 15, salesUnit = 'botellas' } = settings;
  const now = new Date();
  const ym = (d) => d.getFullYear() * 12 + d.getMonth();
  const cur = ym(now);
  const day = now.getDate();

  const pcByKey = new Map(stockItems.map((p) => [p.key, p.porCaja]));
  const byKey = new Map(); // ventas en BOTELLAS por mes (0 = este mes)
  for (const s of sales) {
    const m = cur - ym(s.date);
    if (m < 0 || m > 3) continue;
    let e = byKey.get(s.key);
    if (!e) { e = [0, 0, 0, 0]; byKey.set(s.key, e); }
    const f = s.botella ? 1 : salesUnit === 'cajas' ? (pcByKey.get(s.key) || 6) : 1;
    e[m] += s.qty * f;
  }
  const matchedKeys = new Set();

  const products = stockItems.map((p) => {
    const e = byKey.get(p.key);
    if (e) matchedKeys.add(p.key);
    const [m0, m1, m2, m3] = e || [0, 0, 0, 0];
    const rate = (m0 + m1 + m2 + m3) / (90 + day); // botellas por día, ponderando el mes en curso
    const cajas = p.stockU / p.porCaja;
    const cobertura = rate > 0 ? p.stockU / rate : Infinity;
    let sugeridas = 0;
    if (rate > 0) {
      sugeridas = Math.ceil(Math.max(0, rate * coberturaDias - p.stockU) / p.porCaja);
      if (cajas < umbralCajas) sugeridas = Math.max(sugeridas, Math.ceil(umbralCajas - cajas));
    }
    const vendioReciente = m0 > 0 || m1 > 0;
    let estado;
    if (!p.stockKnown) estado = 'sin-dato';
    else if (p.stockU <= 0 && vendioReciente) estado = 'urgente';
    else if (p.stockU <= 0) estado = 'agotado';
    else if (cajas < 1) estado = 'critico';
    else if (cajas < umbralCajas) estado = 'bajo';
    else if (rate > 0 && cobertura < alertaDias) estado = 'se-acaba';
    else estado = 'ok';
    return {
      ...p, cajas, esteMes: m0, mesPasado: m1, esteMesCj: m0 / p.porCaja, mesPasadoCj: m1 / p.porCaja, prom3: (m1 + m2 + m3) / 3, rate, cobertura,
      sugeridas, estado, rank: ESTADOS[estado].rank, sinRotacion: m0 + m1 + m2 + m3 === 0,
      pedido: openOrders[p.id] || null,
    };
  });

  // Ranking de ventas del mes pasado (hoja "Reporte <mes>"): posición 1 = la más vendida.
  if (ranking?.items?.length) {
    const byKey = new Map();
    for (const p of products) if (!byKey.has(p.key)) byKey.set(p.key, p);
    ranking.items.forEach((r, i) => {
      const p = matchProduct(r.producto, products, byKey);
      if (p && !p.top) { p.top = i + 1; p.topCant = r.cantidad; p.topMes = ranking.mes; }
    });
  }

  // Prioridad de "Más urgente":
  //  0) se queda sin stock en ≤7 días y se vende  → primero lo más vendido (ranking del Reporte)
  //  1) resto de lo que hay que reponer y se vende → menos días de stock primero
  //  2) bajo / en 0 pero sin ventas                 → menos stock primero
  //  3) OK y sin dato                               → al final
  const vend = (p) => p.mesPasado + p.esteMes;
  for (const p of products) {
    // Si figura en el ranking del mes pasado, se vende aunque sus ventas no hayan cruzado por nombre.
    if (p.top && p.stockKnown && p.stockU <= 0 && p.estado === 'agotado') { p.estado = 'urgente'; p.rank = ESTADOS.urgente.rank; }
    if (p.top) p.sinRotacion = false;
    if (p.top && p.rate === 0 && A_REPONER.has(p.estado)) { // sin ventas cruzadas: sugerir según el Reporte (cajas del mes)
      p.sugeridas = Math.max(1, Math.ceil(p.topCant * (coberturaDias / 30) - p.cajas));
    }
    const seVende = p.rate > 0 || !!p.top;
    const corto = p.stockU <= 0 || p.cobertura <= 7;
    p.bucket = !A_REPONER.has(p.estado) ? 3 : seVende && corto ? 0 : seVende ? 1 : 2;
  }
  products.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (a.bucket === 0) return (a.top || 1e4) - (b.top || 1e4) || vend(b) - vend(a) || a.cobertura - b.cobertura;
    if (a.bucket === 1) return a.cobertura - b.cobertura || (a.top || 1e4) - (b.top || 1e4);
    if (a.bucket === 2) return a.cajas - b.cajas || a.producto.localeCompare(b.producto);
    return a.rank - b.rank || (a.top || 1e4) - (b.top || 1e4) || a.cobertura - b.cobertura;
  });

  const bodegas = new Map();
  for (const p of products) {
    let b = bodegas.get(p.bodega);
    if (!b) { b = { nombre: p.bodega, ventas: 0, productos: 0, reponer: 0, urgentes: 0 }; bodegas.set(p.bodega, b); }
    b.productos++;
    b.ventas += p.mesPasadoCj + p.esteMesCj;
    if (A_REPONER.has(p.estado)) b.reponer++;
    if (p.estado === 'urgente') b.urgentes++;
  }

  // Ventas que no cruzan con ningún producto del stock (para avisar)
  const sinMatch = [];
  for (const [k, e] of byKey) if (!matchedKeys.has(k) && e[0] + e[1] > 0) sinMatch.push(k);

  return { products, bodegas: [...bodegas.values()], sinMatch };
}

// ===================== Mensaje de pedido =====================
export function buildMessage(cart, { titulo = 'Pedido Azari Wines', nota = '', mostrarBotellas = false, soloBodega = null } = {}) {
  const items = Object.values(cart).filter((i) => i.cajas > 0 && (!soloBodega || i.bodega === soloBodega));
  if (!items.length) return '';
  const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const grupos = {};
  for (const i of items) (grupos[i.bodega] ||= []).push(i);
  let total = 0;
  const lines = [`*${titulo}* — ${fecha}`, ''];
  for (const b of Object.keys(grupos).sort()) {
    lines.push(`*${b}*`);
    for (const i of grupos[b].sort((x, y) => x.producto.localeCompare(y.producto))) {
      total += i.cajas;
      const bot = mostrarBotellas ? ` (${i.cajas * i.porCaja} bot.)` : '';
      lines.push(`• ${i.cajas} ${i.cajas === 1 ? 'caja' : 'cajas'} — ${i.producto}${bot}`);
    }
    lines.push('');
  }
  lines.push(`Total: ${total} ${total === 1 ? 'caja' : 'cajas'}`);
  if (nota.trim()) lines.push('', nota.trim());
  return lines.join('\n');
}
