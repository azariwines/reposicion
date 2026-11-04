import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { matrixToObjects, detectColumns, parseDate, extractCombos, parseReporte, STOCK_SCHEMA, SALES_SCHEMA } from '../../../lib/core';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

async function fetchCsvMatrix(url) {
  const r = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (text.trim().startsWith('<')) {
    throw new Error('Google devolvió una página y no datos. Revisá que la planilla esté compartida como "Cualquier persona con el enlace: Lector".');
  }
  return Papa.parse(text, { skipEmptyLines: true }).data;
}

const gviz = (id, sheet) =>
  `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;

// Se queda solo con las columnas que usa la app (los costos y márgenes no salen del servidor).
function slim(objs, schema) {
  const { map } = detectColumns(objs, schema);
  const KEYS = schema === STOCK_SCHEMA
    ? { producto: 'PRODUCTO', bodega: 'BODEGA', stockCajas: 'STOCK CAJAS', stock: 'STOCK', porCaja: 'UNIDADES POR CAJA' }
    : { fecha: 'FECHA', producto: 'PRODUCTO', cantidad: 'CANTIDAD', bodega: 'BODEGA' };
  const cols = Object.entries(map).filter(([, c]) => c);
  return objs.map((o) => Object.fromEntries(cols.map(([k, c]) => [KEYS[k], o[c]])));
}

// Hora Argentina para saber en qué mes estamos
const nowAR = () => new Date(Date.now() - 3 * 3600e3);

let salesCache = { at: 0, payload: null };

async function salesFromSheet(id, prefix, errors) {
  const now = nowAR();
  const meses = [0, 1, 2, 3].map((i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
  const parts = await Promise.all(meses.map(async (d) => {
    const name = `${prefix} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    try {
      const objs = slim(matrixToObjects(await fetchCsvMatrix(gviz(id, name)), SALES_SCHEMA), SALES_SCHEMA);
      // Si la hoja no existe, Google devuelve otra: por eso se filtra por el mes que corresponde.
      const ok = objs.filter((o) => {
        const dt = parseDate(o.FECHA);
        return dt && dt.getMonth() === d.getUTCMonth() && dt.getFullYear() === d.getUTCFullYear();
      });
      if (!ok.length && objs.length) errors.push(`No encontré la hoja "${name}"`);
      return ok;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      return [];
    }
  }));
  return parts.flat();
}

async function fetchAirtable() {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE, AIRTABLE_VIEW } = process.env;
  const rows = [];
  let offset;
  do {
    const u = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE || 'Ventas')}`);
    u.searchParams.set('pageSize', '100');
    if (AIRTABLE_VIEW) u.searchParams.set('view', AIRTABLE_VIEW);
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }, cache: 'no-store' });
    if (!r.ok) throw new Error(`Airtable HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    for (const rec of j.records) rows.push({ ...rec.fields, __created: rec.createdTime });
    offset = j.offset;
  } while (offset && rows.length < 60000);
  return rows;
}

export async function GET() {
  const out = { at: new Date().toISOString(), stock: null, sales: null, stockSource: null, salesSource: null, errors: [] };
  const id = process.env.GOOGLE_SHEET_ID;
  const year = nowAR().getUTCFullYear();

  // ---------- STOCK (siempre en vivo, sin caché) ----------
  try {
    if (id) {
      const sheet = process.env.STOCK_SHEET_NAME || `STOCK ${year}`;
      const matrix = await fetchCsvMatrix(gviz(id, sheet));
      const objs = slim(matrixToObjects(matrix, STOCK_SCHEMA), STOCK_SCHEMA);
      if (!objs.length) throw new Error(`No encontré productos en la hoja "${sheet}"`);
      out.stock = { type: 'objects', data: objs };
      out.combos = extractCombos(matrix);
      out.stockSource = `Google Sheets · ${sheet}`;
    } else if (process.env.STOCK_CSV_URL) {
      const matrix = await fetchCsvMatrix(process.env.STOCK_CSV_URL);
      out.stock = { type: 'objects', data: slim(matrixToObjects(matrix, STOCK_SCHEMA), STOCK_SCHEMA) };
      out.combos = extractCombos(matrix);
      out.stockSource = 'Google Sheets';
    }
  } catch (e) {
    out.errors.push('Stock: ' + e.message);
  }

  // ---------- VENTAS (caché de 5 minutos) ----------
  const hasAirtable = process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE_ID;
  if (id || process.env.SALES_CSV_URL || hasAirtable) {
    if (salesCache.payload && Date.now() - salesCache.at < 5 * 60 * 1000) {
      Object.assign(out, salesCache.payload);
    } else {
      const errs = [];
      try {
        let payload;
        if (id && process.env.SALES_FROM !== 'airtable') {
          const prefix = process.env.SALES_SHEET_PREFIX || 'Ventas';
          payload = { sales: { type: 'objects', data: await salesFromSheet(id, prefix, errs) }, salesSource: `Google Sheets · ${prefix} (últimos 4 meses)` };
        } else if (process.env.SALES_CSV_URL) {
          payload = { sales: { type: 'objects', data: slim(matrixToObjects(await fetchCsvMatrix(process.env.SALES_CSV_URL), SALES_SCHEMA), SALES_SCHEMA) }, salesSource: 'Google Sheets' };
        } else {
          payload = { sales: { type: 'objects', data: await fetchAirtable() }, salesSource: 'Airtable' };
        }
        if (id) { // ranking de ventas del mes pasado (hoja "Reporte <Mes> <Año>")
          const now = nowAR();
          const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
          const name = `${process.env.REPORT_SHEET_PREFIX || 'Reporte'} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
          try {
            const items = parseReporte(await fetchCsvMatrix(gviz(id, name)));
            if (items.length) payload.ranking = { mes: MESES[d.getUTCMonth()].toLowerCase(), items };
          } catch (e) { errs.push(`${name}: ${e.message}`); }
        }
        payload.salesErrors = errs;
        salesCache = { at: Date.now(), payload };
        Object.assign(out, payload);
      } catch (e) {
        out.errors.push('Ventas: ' + e.message);
      }
    }
    if (out.salesErrors?.length) out.errors.push(...out.salesErrors.map((e) => 'Ventas: ' + e));
    delete out.salesErrors;
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
