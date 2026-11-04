'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import {
  STOCK_SCHEMA, SALES_SCHEMA, ESTADOS, A_REPONER,
  matrixToObjects, parseStock, parseSales, buildModel, buildMessage, detectColumns, extractCombos, computeCombos,
} from '../lib/core';
import { demoData } from '../lib/demo';

// ---------- persistencia local (por navegador) ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('azari.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('azari.' + k, JSON.stringify(v)); return true; } catch { return false; } },
};
function usePersisted(key, initial) {
  const [v, setV] = useState(initial);
  const loaded = useRef(false);
  useEffect(() => { setV(LS.get(key, initial)); loaded.current = true; }, []); // eslint-disable-line
  useEffect(() => { if (loaded.current) LS.set(key, v); }, [key, v]);
  return [v, setV];
}

const DEFAULT_SETTINGS = {
  umbralCajas: 2, coberturaDias: 30, alertaDias: 15,
  stockUnit: 'cajas', salesUnit: 'cajas', defaultPorCaja: 6,
  titulo: 'Pedido Azari Wines', mostrarBotellas: false,
  pinned: ['Catena Zapata', 'Rutini Wines'], stockMap: {}, salesMap: {},
};
const PAGE = 60;
const ORDENES = [['urgencia', 'Más urgente', 'primero lo que se vende y se queda sin stock esta semana'], ['mas-stock', 'Más stock', 'más stock primero'], ['mas-vendido', 'Más vendidos', 'más vendidos primero'], ['az', 'A–Z', 'por nombre']];
const ORDEN_LABEL = Object.fromEntries(ORDENES.map(([k, , l]) => [k, l]));

const n1 = (n) => (Math.round(n * 10) / 10).toLocaleString('es-AR');
const n0 = (n) => Math.round(n).toLocaleString('es-AR');
const cj = (n) => `${n1(n)} ${Math.abs(n - 1) < 0.05 ? 'caja' : 'cajas'}`;
const hace = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
};
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

// ---------- iconos (trazo 2px, 24px) ----------
const P = {
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'M6 6l12 12M18 6 6 18',
  copy: 'M9 9h10v10H9zM5 15V5h10', check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  arrow: 'M5 12h14M13 6l6 6-6 6', cart: 'M9 5h10l-1.5 9H7.5L6 3H3M9 20h.01M17 20h.01',
  wine: 'M8 3h8l-.5 6a3.5 3.5 0 0 1-7 0L8 3ZM12 12.5V20M8.5 20h7',
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name]} /></svg>
);

async function readFileAsObjects(file, schema) {
  const name = file.name.toLowerCase();
  let matrix;
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    matrix = Papa.parse(await file.text(), { skipEmptyLines: true }).data;
  } else {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
    let best = null;
    for (const sn of wb.SheetNames) {
      const m = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true });
      const objs = matrixToObjects(m, schema);
      const { map } = detectColumns(objs, schema);
      const score = (map.producto ? 1e6 : 0) + objs.length;
      if (!best || score > best.score) best = { score, m };
    }
    matrix = best ? best.m : [];
  }
  return { rows: matrixToObjects(matrix, schema), combos: schema === STOCK_SCHEMA ? extractCombos(matrix) : [] };
}

export default function Home() {
  const [settings, setSettings] = usePersisted('settings.v2', DEFAULT_SETTINGS);
  const S = { ...DEFAULT_SETTINGS, ...settings };
  const setS = (patch) => setSettings((s) => ({ ...DEFAULT_SETTINGS, ...s, ...patch }));

  const [remote, setRemote] = useState({ loading: true });
  const [uploads, setUploads] = usePersisted('uploads', { stock: null, sales: null });
  const [cart, setCart] = usePersisted('cart', {});
  const [orders, setOrders] = usePersisted('orders', []);

  const [bodega, setBodega] = useState('');
  const [q, setQ] = useState('');
  const [vista, setVista] = useState('reponer');
  const [ocultarSinRot, setOcultarSinRot] = useState(false);
  const [orden, setOrden] = useState('urgencia');
  const [seccion, setSeccion] = useState('etiquetas'); // etiquetas | combos
  const [panel, setPanel] = useState(null); // cart | settings | history
  const [toast, setToast] = useState('');
  const [nota, setNota] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const toastT = useRef();

  const flash = (t) => { setToast(t); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 2600); };

  // ---------- carga en vivo ----------
  const load = useCallback(async () => {
    setRemote((r) => ({ ...r, loading: true }));
    try {
      const j = typeof window !== 'undefined' && window.__AZARI_LOADER__
        ? await window.__AZARI_LOADER__()
        : await (await fetch('/api/data', { cache: 'no-store' })).json();
      setRemote({ loading: false, ...j });
    } catch (e) {
      setRemote((r) => ({ ...r, loading: false, failed: true, errors: [e?.userMessage || 'No se pudo conectar con el servidor.'] }));
    }
  }, []);
  useEffect(() => {
    load();
    const every = (typeof window !== 'undefined' && window.__AZARI_REFRESH_MS__) || 60000;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, every);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { setLimit(PAGE); }, [bodega, vista, q, ocultarSinRot, orden]);
  useEffect(() => {
    if (!panel) return;
    const onKey = (e) => e.key === 'Escape' && setPanel(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  // ---------- fuentes de datos ----------
  const sources = useMemo(() => {
    const toObjs = (p, schema) => (p ? (p.type === 'matrix' ? matrixToObjects(p.data, schema) : p.data) : null);
    let stockRows = toObjs(remote.stock, STOCK_SCHEMA), stockSrc = remote.stockSource;
    if (!stockRows && uploads?.stock) { stockRows = uploads.stock.rows; stockSrc = `Archivo · ${uploads.stock.name}`; }
    let salesRows = toObjs(remote.sales, SALES_SCHEMA), salesSrc = remote.salesSource;
    if (!salesRows && uploads?.sales) { salesRows = uploads.sales.rows; salesSrc = `Archivo · ${uploads.sales.name}`; }
    let demo = false;
    let combos = remote.stock ? remote.combos || [] : uploads?.stock ? uploads.stock.combos || [] : null;
    if (!stockRows) {
      const d = demoData();
      stockRows = d.stockRows; stockSrc = 'Datos de ejemplo'; combos = d.combos;
      if (!salesRows) { salesRows = d.salesRows; salesSrc = 'Datos de ejemplo'; }
      demo = true;
    }
    return { stockRows, salesRows: salesRows || [], stockSrc, salesSrc, demo, combos: combos || [] };
  }, [remote.stock, remote.sales, remote.combos, remote.stockSource, remote.salesSource, uploads]);

  const parsedStock = useMemo(
    () => parseStock(sources.stockRows, { overrides: S.stockMap, stockUnit: S.stockUnit, defaultPorCaja: S.defaultPorCaja }),
    [sources.stockRows, S.stockMap, S.stockUnit, S.defaultPorCaja] // eslint-disable-line
  );
  const parsedSales = useMemo(() => parseSales(sources.salesRows, { overrides: S.salesMap }), [sources.salesRows, S.salesMap]); // eslint-disable-line

  const openOrders = useMemo(() => {
    const m = {};
    for (const o of orders) {
      if (o.recibido || Date.now() - new Date(o.fecha) > 30 * 864e5) continue;
      for (const it of o.items) {
        const prev = m[it.id];
        m[it.id] = { cajas: (prev?.cajas || 0) + it.cajas, fecha: prev?.fecha && prev.fecha > o.fecha ? prev.fecha : o.fecha };
      }
    }
    return m;
  }, [orders]);

  const model = useMemo(
    () => buildModel(parsedStock.items, parsedSales.sales, S, openOrders, sources.demo ? null : remote.ranking),
    [parsedStock, parsedSales, S.umbralCajas, S.coberturaDias, S.alertaDias, S.salesUnit, openOrders, remote.ranking, sources.demo] // eslint-disable-line
  );

  const combos = useMemo(() => computeCombos(sources.combos, model.products), [sources.combos, model.products]);

  const principales = useMemo(() => {
    const pinned = S.pinned || [];
    return [...model.bodegas].sort((a, b) => {
      const pa = pinned.indexOf(a.nombre), pb = pinned.indexOf(b.nombre);
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return b.ventas - a.ventas || b.reponer - a.reponer;
    }).slice(0, 10);
  }, [model.bodegas, S.pinned]);

  const counts = useMemo(() => {
    const c = { urgente: 0, agotado: 0, reponer: 0, todos: 0 };
    for (const p of model.products) {
      if (bodega && p.bodega !== bodega) continue;
      c.todos++;
      if (p.estado === 'urgente') c.urgente++;
      if (p.estado === 'agotado' || p.estado === 'urgente') c.agotado++;
      if (A_REPONER.has(p.estado)) c.reponer++;
    }
    return c;
  }, [model.products, bodega]);

  const lista = useMemo(() => {
    const words = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
    const out = model.products.filter((p) => {
      if (bodega && p.bodega !== bodega) return false;
      if (vista === 'reponer' && !A_REPONER.has(p.estado)) return false;
      if (vista === 'urgente' && p.estado !== 'urgente') return false;
      if (vista === 'agotado' && !(p.estado === 'agotado' || p.estado === 'urgente')) return false;
      if (ocultarSinRot && p.sinRotacion) return false;
      if (words.length) {
        const hay = (p.producto + ' ' + p.bodega).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const vend = (p) => p.mesPasado + p.esteMes;
    const sorters = {
      urgencia: null, // ya viene ordenado por urgencia
      'mas-stock': (a, b) => b.cajas - a.cajas || vend(b) - vend(a),
      'mas-vendido': (a, b) => (a.top || 1e4) - (b.top || 1e4) || vend(b) - vend(a) || a.cajas - b.cajas,
      az: (a, b) => a.producto.localeCompare(b.producto),
    };
    return sorters[orden] ? [...out].sort(sorters[orden]) : out;
  }, [model.products, bodega, vista, ocultarSinRot, q, orden]);

  // ---------- pedido ----------
  const cartItems = Object.values(cart || {}).filter((i) => i.cajas > 0);
  const cartTotal = cartItems.reduce((s, i) => s + i.cajas, 0);
  const cartBodegas = new Set(cartItems.map((i) => i.bodega)).size;
  const setQty = (p, cajas) => setCart((c) => {
    const n = { ...c };
    if (cajas <= 0) delete n[p.id];
    else n[p.id] = { id: p.id, producto: p.producto, bodega: p.bodega, porCaja: p.porCaja, cajas };
    return n;
  });
  const sugeribles = lista.filter((p) => p.sugeridas > 0 && !cart?.[p.id] && !p.pedido);
  const agregarSugeridos = () => {
    if (!sugeribles.length) return;
    setCart((c) => {
      const n = { ...c };
      for (const p of sugeribles) n[p.id] = { id: p.id, producto: p.producto, bodega: p.bodega, porCaja: p.porCaja, cajas: p.sugeridas };
      return n;
    });
    flash(`Sumé ${plural(sugeribles.length, 'etiqueta', 'etiquetas')} con la cantidad sugerida`);
  };
  const mensaje = buildMessage(cart || {}, { titulo: S.titulo, nota, mostrarBotellas: S.mostrarBotellas });
  const copiar = async (txt) => {
    try { await navigator.clipboard.writeText(txt); flash('Mensaje copiado. Pegalo en el grupo de pedidos.'); return true; }
    catch { flash('No pude copiar automáticamente: mantené apretado el texto para copiarlo.'); return false; }
  };
  const confirmarPedido = () => {
    if (!cartItems.length) return;
    setOrders((o) => [{ id: Date.now(), fecha: new Date().toISOString(), items: cartItems, mensaje, recibido: false }, ...o].slice(0, 100));
    setCart({}); setNota(''); setPanel(null);
    flash('Pedido guardado. Esas etiquetas quedan marcadas como pedidas.');
  };

  // ---------- subir archivos ----------
  const onUpload = async (kind, file) => {
    if (!file) return;
    try {
      const schema = kind === 'stock' ? STOCK_SCHEMA : SALES_SCHEMA;
      const { rows, combos } = await readFileAsObjects(file, schema);
      const payload = { name: file.name, at: new Date().toISOString(), rows, combos };
      if (!LS.set('uploads', { ...uploads, [kind]: payload })) {
        const { map } = detectColumns(rows, schema);
        const keep = Object.values(map).filter(Boolean);
        payload.rows = rows.map((r) => Object.fromEntries(keep.map((k) => [k, r[k]])));
      }
      setUploads({ ...uploads, [kind]: payload });
      flash(`${kind === 'stock' ? 'Stock' : 'Ventas'}: ${n0(rows.length)} filas cargadas`);
    } catch (e) {
      flash('No pude leer el archivo: ' + e.message);
    }
  };

  const firstLoad = remote.loading && !remote.at && !remote.failed;
  const hora = remote.at ? new Date(remote.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
  const todasBodegas = [...model.bodegas].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const statusKind = sources.demo ? 'demo' : remote.errors?.length ? 'err' : 'live';
  const vistaLabel = { reponer: 'para reponer', urgente: 'urgentes', agotado: 'en cero', todos: '' }[vista];

  const orderPanel = (
    <CartPanel {...{ cartItems, cartTotal, setQty, mensaje, copiar, confirmarPedido, nota, setNota, S, setS, setCart }} />
  );

  return (
    <div className="app">
      <header className="top">
        <div style={{ minWidth: 0 }}>
          <div className="brand"><span className="wordmark">Azari</span><h1>Reposición</h1></div>
          <p className="status" aria-live="polite">
            <span className={`dot ${statusKind}`} aria-hidden="true" />
            {firstLoad ? 'Leyendo la planilla…'
              : sources.demo ? 'Modo demo · datos de ejemplo'
              : `${sources.stockSrc}${hora ? ` · ${hora}` : ''}`}
          </p>
        </div>
        <div className="top-actions">
          <button className={'icon-btn' + (remote.loading ? ' spin' : '')} onClick={load} aria-label="Actualizar stock ahora" title="Actualizar"><Icon name="refresh" /></button>
          <button className="icon-btn" onClick={() => setPanel('history')} aria-label="Pedidos anteriores" title="Pedidos anteriores"><Icon name="clock" /></button>
          <button className="icon-btn" onClick={() => setPanel('settings')} aria-label="Ajustes y conexión" title="Ajustes"><Icon name="settings" /></button>
        </div>
      </header>

      <div className={'layout' + (cartTotal > 0 ? ' has-order' : '')}>
        <main>
          {!firstLoad && (
            <Alerts {...{ remote, sources, model, load, setPanel }} />
          )}

          {!firstLoad && (
            <nav className="tabs" aria-label="Secciones">
              <button aria-pressed={seccion === 'etiquetas'} onClick={() => setSeccion('etiquetas')}>Etiquetas</button>
              <button aria-pressed={seccion === 'combos'} onClick={() => setSeccion('combos')}>
                Combos {combos.some((c) => !c.completo) && <span className="count hot">{combos.filter((c) => !c.completo).length}</span>}
              </button>
            </nav>
          )}
          {firstLoad ? <Skeleton /> : seccion === 'combos' ? (
            <CombosView combos={combos} cart={cart} setQty={setQty} setCart={setCart} flash={flash} />
          ) : (
            <>
              <div className="summary" role="group" aria-label="Resumen">
                <button className="kpi urg" aria-pressed={vista === 'urgente'} onClick={() => setVista(vista === 'urgente' ? 'reponer' : 'urgente')}>
                  <span className="kpi-value">{counts.urgente}</span><span className="kpi-label">Urgentes</span>
                </button>
                <button className="kpi ago" aria-pressed={vista === 'agotado'} onClick={() => setVista(vista === 'agotado' ? 'reponer' : 'agotado')}>
                  <span className="kpi-value">{counts.agotado}</span><span className="kpi-label">En cero</span>
                </button>
                <button className="kpi rep" aria-pressed={vista === 'reponer'} onClick={() => setVista('reponer')}>
                  <span className="kpi-value">{counts.reponer}</span><span className="kpi-label">Para reponer</span>
                </button>
              </div>

              <div className="section-head">
                <h2>Bodegas</h2>
                <select className="select" style={{ width: 'auto', minHeight: 36, fontSize: 13.5 }} value={bodega} onChange={(e) => setBodega(e.target.value)} aria-label="Elegir cualquier bodega o categoría">
                  <option value="">Todas ({todasBodegas.length})</option>
                  {todasBodegas.map((b) => <option key={b.nombre} value={b.nombre}>{b.nombre}{b.reponer ? ` · ${b.reponer}` : ''}</option>)}
                </select>
              </div>
              <div className="rail" role="group" aria-label="Bodegas principales">
                <button className="chip" aria-pressed={!bodega} onClick={() => setBodega('')}>Todas</button>
                {principales.map((b) => (
                  <button key={b.nombre} className="chip" aria-pressed={bodega === b.nombre} onClick={() => setBodega(bodega === b.nombre ? '' : b.nombre)}
                    aria-label={`${b.nombre}: ${b.reponer} para reponer${b.urgentes ? `, ${b.urgentes} urgentes` : ''}`}>
                    {S.pinned.includes(b.nombre) && <span className="star" aria-hidden="true">★</span>}
                    {b.nombre}
                    {b.reponer > 0 && <span className={'count' + (b.urgentes ? ' hot' : '')}>{b.reponer}</span>}
                  </button>
                ))}
              </div>

              <div className="toolbar">
                <div className="search">
                  <Icon name="search" />
                  <input className="input" type="search" placeholder="Buscar etiqueta o bodega" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar etiqueta o bodega" />
                </div>
                <div className="toolbar-row">
                  <div className="segmented" role="group" aria-label="Qué mostrar">
                    {[['reponer', 'Para reponer', counts.reponer], ['urgente', 'Urgentes', counts.urgente], ['agotado', 'En cero', counts.agotado], ['todos', 'Todo', counts.todos]].map(([k, l, n]) => (
                      <button key={k} aria-pressed={vista === k} onClick={() => setVista(k)}>{l}<span className="n">{n}</span></button>
                    ))}
                  </div>
                </div>
                <div className="toolbar-row">
                  <div className="filter-group" role="group" aria-label="Ordenar">
                    <span className="filter-label">Ordenar</span>
                    {ORDENES.map(([k, l]) => (
                      <button key={k} className="pill-btn" aria-pressed={orden === k} onClick={() => setOrden(k)}>{l}</button>
                    ))}
                  </div>
                </div>
                <label className="switch"><input type="checkbox" checked={ocultarSinRot} onChange={(e) => setOcultarSinRot(e.target.checked)} /> Ocultar las que no se vendieron en 90 días</label>
              </div>

              <div className="context">
                <span>
                  {plural(lista.length, 'etiqueta', 'etiquetas')}{vistaLabel ? ` ${vistaLabel}` : ''}{bodega ? ` en ${bodega}` : ''} · {ORDEN_LABEL[orden]}
                  {(orden !== 'urgencia' || ocultarSinRot) && <> · <button className="link" onClick={() => { setOrden('urgencia'); setOcultarSinRot(false); }}>Limpiar filtros</button></>}
                </span>
                {sugeribles.length > 0 && (
                  <button className="btn btn-secondary btn-sm" onClick={agregarSugeridos}><Icon name="plus" />Sumar sugeridos ({sugeribles.length})</button>
                )}
              </div>

              <section className="list" aria-label="Etiquetas">
                {lista.length === 0 && (
                  <Empty vista={vista} bodega={bodega} q={q} onAll={() => { setVista('todos'); setBodega(''); }} />
                )}
                {lista.slice(0, limit).map((p) => (
                  <ProductRow key={p.id} p={p} enCarrito={cart?.[p.id]?.cajas || 0} setQty={setQty} umbral={S.umbralCajas} />
                ))}
                {lista.length > limit && (
                  <div className="load-more"><button className="btn btn-ghost" onClick={() => setLimit(limit + PAGE)}>Mostrar {Math.min(PAGE, lista.length - limit)} más</button></div>
                )}
              </section>
            </>
          )}
        </main>

        {cartTotal > 0 && (
          <aside className="order-aside" aria-label="Pedido en armado">
            <h2 className="panel-title" style={{ marginBottom: 12 }}>Pedido</h2>
            {orderPanel}
          </aside>
        )}
      </div>

      {cartTotal > 0 && !panel && (
        <div className="order-bar" role="region" aria-label="Pedido en armado">
          <div><b>{cj(cartTotal)}</b><span>{plural(cartBodegas, 'bodega', 'bodegas')} · {plural(cartItems.length, 'etiqueta', 'etiquetas')}</span></div>
          <button className="btn" onClick={() => setPanel('cart')}>Revisar pedido <Icon name="arrow" /></button>
        </div>
      )}

      <div aria-live="polite" className="sr-only">{toast}</div>
      {toast && <div className="toast" role="status">{toast}</div>}

      {panel && (
        <div className="overlay" onClick={() => setPanel(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
            <div className="grabber" aria-hidden="true" />
            <div className="sheet-head">
              <h2 id="sheet-title" className="panel-title">{panel === 'cart' ? 'Pedido' : panel === 'history' ? 'Pedidos anteriores' : 'Ajustes'}</h2>
              <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Cerrar" autoFocus><Icon name="close" /></button>
            </div>
            {panel === 'cart' && orderPanel}
            {panel === 'history' && <HistoryPanel {...{ orders, setOrders, copiar, setCart, setPanel, flash }} />}
            {panel === 'settings' && <SettingsPanel {...{ S, setS, uploads, setUploads, onUpload, remote, sources, parsedStock, parsedSales, model, todasBodegas }} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Componentes ============

function Alerts({ remote, sources, model, load, setPanel }) {
  const items = [];
  if (remote.errors?.length) {
    items.push(
      <div key="err" className="alert error" role="alert">
        <Icon name="alert" />
        <div className="alert-body">
          {remote.errors.slice(0, 3).map((e) => <span key={e}>{e}</span>)}
          <div className="alert-actions"><button className="link" onClick={load}>Reintentar</button></div>
        </div>
      </div>
    );
  }
  if (sources.demo) {
    items.push(
      <div key="demo" className="alert warn">
        <Icon name="alert" />
        <div className="alert-body">
          <span>Estás viendo <b>datos de ejemplo</b>. Los números no son reales.</span>
          <div className="alert-actions"><button className="link" onClick={() => setPanel('settings')}>Cómo conectar la planilla</button></div>
        </div>
      </div>
    );
  } else if (!sources.salesRows.length) {
    items.push(
      <div key="sales" className="alert warn">
        <Icon name="alert" />
        <div className="alert-body">
          <span>No hay ventas cargadas: veo el stock, pero no puedo marcar urgentes ni sugerir cantidades.</span>
          <div className="alert-actions"><button className="link" onClick={() => setPanel('settings')}>Cargar ventas</button></div>
        </div>
      </div>
    );
  }
  return items.length ? <div className="alerts">{items}</div> : null;
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <div className="summary">{[0, 1, 2].map((i) => <div key={i} className="kpi"><div className="skel" style={{ height: 26, width: 40 }} /><div className="skel" style={{ height: 12, width: 70 }} /></div>)}</div>
      <div className="rail">{[90, 120, 100, 110].map((w, i) => <div key={i} className="skel" style={{ height: 40, width: w, borderRadius: 999, flex: 'none' }} />)}</div>
      <div className="list">{[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="skel-row"><div className="skel" style={{ height: 12, width: 80 }} /><div className="skel" style={{ height: 16, width: '60%' }} /><div className="skel" style={{ height: 12, width: '85%' }} /></div>
      ))}</div>
    </div>
  );
}

function Empty({ vista, bodega, q, onAll }) {
  if (q) return <div className="empty"><h3>Sin resultados</h3><p>No encontré “{q}”{bodega ? ` en ${bodega}` : ''}. Probá con otra palabra o buscá en todo el stock.</p><button className="btn btn-secondary" onClick={onAll}>Buscar en todo el stock</button></div>;
  if (vista !== 'todos') return <div className="empty"><Icon name="wine" /><h3>Todo en orden</h3><p>{bodega ? `${bodega} no tiene` : 'No hay'} etiquetas {vista === 'urgente' ? 'urgentes' : vista === 'agotado' ? 'en cero' : 'para reponer'} con las reglas actuales.</p><button className="btn btn-secondary" onClick={onAll}>Ver todo el stock</button></div>;
  return <div className="empty"><h3>No hay etiquetas</h3><p>La planilla no trajo productos para este filtro.</p></div>;
}

function ProductRow({ p, enCarrito, setQty, umbral }) {
  const pct = p.stockKnown ? Math.min(100, (p.cajas / Math.max(umbral * 2, 1)) * 100) : 0;
  const dura = p.rate > 0 ? (p.cobertura < 1 ? '0 días' : `${n0(Math.min(p.cobertura, 999))} días`) : '—';
  return (
    <article className={`row st-${p.estado}` + (enCarrito ? ' in-cart' : '')}>
      <div className="row-main">
        <div className="row-tags">
          <span className="tag state" title={ESTADOS[p.estado].hint}>{ESTADOS[p.estado].label}</span>
          {p.pedido && <span className="tag ped">Pedido {p.pedido.cajas} cj · {hace(p.pedido.fecha)}</span>}
          {p.top && p.top <= 20 && <span className="tag top" title={`${n0(p.topCant)} vendidas en ${p.topMes}`}>#{p.top} en {p.topMes}</span>}
          {p.sinRotacion && <span className="tag quiet">Sin ventas 90 días</span>}
        </div>
        <h3>{p.producto}</h3>
        <p className="sub">{p.bodega} · caja x{p.porCaja}</p>
      </div>
      <div className="row-act">
        {p.sugeridas > 0 && !enCarrito && (
          <button className="sug" onClick={() => setQty(p, p.sugeridas)} aria-label={`Sumar ${p.sugeridas} cajas sugeridas de ${p.producto}`}>+{p.sugeridas} sugeridas</button>
        )}
        <div className="stepper" role="group" aria-label={`Cajas de ${p.producto} en el pedido`}>
          <button onClick={() => setQty(p, enCarrito - 1)} disabled={!enCarrito} aria-label={`Restar una caja de ${p.producto}`}><Icon name="minus" /></button>
          <output className={enCarrito ? 'on' : ''} aria-live="polite">{enCarrito}</output>
          <button onClick={() => setQty(p, enCarrito + 1)} aria-label={`Sumar una caja de ${p.producto}`}><Icon name="plus" /></button>
        </div>
      </div>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">Stock</span>
          <span className="stat-value stock-value">{p.stockKnown ? n1(p.cajas) : '?'}<small>cj</small></span>
          <div className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="stat"><span className="stat-label">Mes pasado</span><span className="stat-value">{n1(p.mesPasadoCj)}<small>cj</small></span></div>
        <div className="stat"><span className="stat-label">Este mes</span><span className="stat-value">{n1(p.esteMesCj)}<small>cj</small></span></div>
        <div className="stat"><span className="stat-label">Alcanza</span><span className="stat-value">{dura}</span></div>
      </div>
    </article>
  );
}

const GRUPOS = ['Recomendadas', 'Essentials', 'Signature', 'Mystery Box'];
const ITEM_ESTADO = {
  falta: { label: 'Falta', cls: 'st-urgente' },
  poco: { label: 'Menos de 1 caja', cls: 'st-bajo' },
  ok: { label: 'OK', cls: 'st-ok' },
  nf: { label: 'No está en el stock', cls: 'st-sin-dato' },
};

function CombosView({ combos, cart, setQty, setCart, flash }) {
  const [grupo, setGrupo] = useState('');
  const [soloFaltan, setSoloFaltan] = useState(false);
  const visibles = combos.filter((c) => (!grupo || c.grupo === grupo) && (!soloFaltan || !c.completo));
  const sumarFaltantes = (c) => {
    const add = c.faltan.filter((i) => i.p && !cart?.[i.p.id]);
    if (!add.length) { flash('Las etiquetas que faltan ya están en el pedido o no están en el stock'); return; }
    setCart((cc) => {
      const n = { ...cc };
      for (const i of add) n[i.p.id] = { id: i.p.id, producto: i.p.producto, bodega: i.p.bodega, porCaja: i.p.porCaja, cajas: 1 };
      return n;
    });
    flash(`Sumé 1 caja de ${plural(add.length, 'etiqueta', 'etiquetas')} para ${c.nombre}`);
  };
  if (!combos.length) {
    return <div className="list"><div className="empty"><Icon name="wine" /><h3>No encontré combos</h3><p>Busco en la hoja de stock las filas “RECOMENDADOS…”, “Combo Essential…”, “Azari Signature…” y “Mystery BOX…”, con sus etiquetas debajo (R1, ES1, AS, M1…).</p></div></div>;
  }
  return (
    <div>
      <p className="lead">Para armar un combo se necesita <b>al menos 1 caja de cada etiqueta</b>. Acá ves cuáles faltan para poder armar cada uno.</p>
      <div className="rail" role="group" aria-label="Tipo de combo">
        <button className="chip" aria-pressed={!grupo} onClick={() => setGrupo('')}>Todos</button>
        {GRUPOS.map((g) => {
          const cs = combos.filter((c) => c.grupo === g);
          if (!cs.length) return null;
          const inc = cs.filter((c) => !c.completo).length;
          return <button key={g} className="chip" aria-pressed={grupo === g} onClick={() => setGrupo(grupo === g ? '' : g)}>{g}{inc > 0 && <span className="count hot">{inc}</span>}</button>;
        })}
      </div>
      <label className="switch"><input type="checkbox" checked={soloFaltan} onChange={(e) => setSoloFaltan(e.target.checked)} /> Mostrar solo los que tienen faltantes</label>
      <div className="combo-list">
        {visibles.length === 0 && <div className="list"><div className="empty"><h3>Todos completos</h3><p>No hay combos con etiquetas faltantes en este grupo.</p></div></div>}
        {visibles.map((c) => {
          const pedibles = c.faltan.filter((i) => i.p).length;
          return (
            <article key={c.id + c.nombre} className={'combo ' + (c.completo ? 'st-ok' : c.faltan.some((i) => i.estado === 'falta' || i.estado === 'nf') ? 'st-urgente' : 'st-bajo')}>
              <header className="combo-head">
                <div style={{ minWidth: 0 }}>
                  <span className="tag quiet">{c.grupo}</span>
                  <h3>{c.nombre}</h3>
                </div>
                <div className="combo-status">
                  {c.completo
                    ? <span className="tag state">Se puede armar</span>
                    : <span className="tag state">{c.faltan.length === 1 ? 'Falta 1 etiqueta' : `Faltan ${c.faltan.length} etiquetas`}</span>}
                </div>
              </header>
              <div className="combo-nums">
                <div className="stat"><span className="stat-label">Armados</span><span className="stat-value">{n1(c.armadas)}<small>cj</small></span></div>
                <div className="stat"><span className="stat-label">Se pueden armar</span><span className="stat-value">{n0(c.posibles)}<small>más</small></span></div>
                <div className="stat"><span className="stat-label">Etiquetas</span><span className="stat-value">{c.items.length}</span></div>
              </div>
              <ul className="combo-items">
                {c.items.map((i) => {
                  const st = ITEM_ESTADO[i.estado];
                  return (
                    <li key={i.label} className={st.cls}>
                      <span className="ci-dot" aria-hidden="true" />
                      <span className="ci-name">{i.p ? i.p.producto : i.label}{i.n > 1 && <small> ×{i.n}</small>}{i.p && <small className="muted"> · {i.p.bodega}</small>}</span>
                      <span className="ci-stock num">{i.p ? `${n1(i.p.cajas)} cj` : '—'}</span>
                      <span className="ci-state">{st.label}</span>
                    </li>
                  );
                })}
              </ul>
              {!c.completo && pedibles > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => sumarFaltantes(c)}><Icon name="plus" />Sumar faltantes al pedido ({pedibles})</button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function CartPanel({ cartItems, cartTotal, setQty, mensaje, copiar, confirmarPedido, nota, setNota, S, setS, setCart }) {
  const [copiado, setCopiado] = useState(false);
  const [vaciar, setVaciar] = useState(false);
  useEffect(() => { setCopiado(false); }, [mensaje]);
  if (!cartItems.length) {
    return <div className="empty"><h3>El pedido está vacío</h3><p>Sumá cajas con el “+” de cada etiqueta o con “Sumar sugeridos”.</p></div>;
  }
  const grupos = {};
  for (const i of cartItems) (grupos[i.bodega] ||= []).push(i);
  const msgBodega = (b) => buildMessage(Object.fromEntries(grupos[b].map((i) => [i.id, i])), { titulo: S.titulo, nota, mostrarBotellas: S.mostrarBotellas });
  return (
    <div className="stack">
      {Object.keys(grupos).sort().map((b) => (
        <div key={b} className="cart-group">
          <div className="cart-group-head">
            <h3>{b}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => copiar(msgBodega(b))}><Icon name="copy" />Copiar solo esta</button>
          </div>
          {grupos[b].map((i) => (
            <div key={i.id} className="cart-line">
              <span>{i.producto}</span>
              <div className="stepper sm" role="group" aria-label={`Cajas de ${i.producto}`}>
                <button onClick={() => setQty(i, i.cajas - 1)} aria-label={`Restar una caja de ${i.producto}`}><Icon name="minus" /></button>
                <output className="on">{i.cajas}</output>
                <button onClick={() => setQty(i, i.cajas + 1)} aria-label={`Sumar una caja de ${i.producto}`}><Icon name="plus" /></button>
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="cart-total"><span>Total</span><span className="big num">{cj(cartTotal)}</span></div>

      <label className="field">Nota para el grupo (opcional)
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: entregar el jueves por la mañana" />
      </label>
      <label className="switch"><input type="checkbox" checked={S.mostrarBotellas} onChange={(e) => setS({ mostrarBotellas: e.target.checked })} /> Agregar botellas al lado de las cajas</label>

      <div className="preview">
        <div className="preview-label">Así se va a ver en WhatsApp</div>
        <pre>{mensaje}</pre>
      </div>

      {!copiado ? (
        <div className="actions">
          <button className="btn btn-primary" onClick={async () => { if (await copiar(mensaje)) setCopiado(true); }}><Icon name="copy" />Copiar mensaje</button>
          <a className="btn btn-wa" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer" onClick={() => setCopiado(true)}>WhatsApp</a>
        </div>
      ) : (
        <div className="done-box" role="status">
          <p><strong>Listo, copiado.</strong> Pegalo en el grupo de pedidos. Cuando lo mandes, guardalo así esas etiquetas quedan marcadas como pedidas.</p>
          <button className="btn btn-primary btn-block" onClick={confirmarPedido}><Icon name="check" />Ya lo mandé · guardar pedido</button>
          <button className="link" style={{ justifySelf: 'start' }} onClick={() => copiar(mensaje)}>Copiar de nuevo</button>
        </div>
      )}

      {!vaciar ? (
        <button className="btn btn-ghost btn-danger" style={{ justifySelf: 'start' }} onClick={() => setVaciar(true)}>Vaciar pedido</button>
      ) : (
        <div className="confirm-row" role="alert">
          <span>¿Vaciar las {cartTotal} cajas?</span>
          <button className="btn btn-secondary btn-sm btn-danger" onClick={() => { setCart({}); setVaciar(false); }}>Sí, vaciar</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setVaciar(false)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ orders, setOrders, copiar, setCart, setPanel, flash }) {
  const [borrar, setBorrar] = useState(null);
  if (!orders.length) {
    return <div className="empty"><Icon name="clock" /><h3>Todavía no hay pedidos</h3><p>Cuando mandes uno y toques “Ya lo mandé”, queda acá. Esas etiquetas se marcan como pedidas para no pedirlas dos veces.</p></div>;
  }
  return (
    <div className="stack-sm">
      {orders.map((o) => {
        const total = o.items.reduce((s, i) => s + i.cajas, 0);
        const bods = [...new Set(o.items.map((i) => i.bodega))];
        return (
          <div key={o.id} className={'order' + (o.recibido ? ' done' : '')}>
            <div className="order-head">
              <b>{new Date(o.fecha).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })}</b>
              <span className={'tag ' + (o.recibido ? 'quiet' : 'ped')}>{o.recibido ? 'Recibido' : 'En camino'}</span>
            </div>
            <p className="small muted">{cj(total)} · {bods.join(', ')}</p>
            <div className="row-links">
              <button className="link" onClick={() => setOrders((os) => os.map((x) => (x.id === o.id ? { ...x, recibido: !x.recibido } : x)))}>{o.recibido ? 'Marcar en camino' : 'Marcar recibido'}</button>
              <button className="link" onClick={() => copiar(o.mensaje)}>Copiar mensaje</button>
              <button className="link" onClick={() => { setCart(Object.fromEntries(o.items.map((i) => [i.id, i]))); setPanel('cart'); flash('Pedido cargado para repetir'); }}>Repetir</button>
              {borrar === o.id
                ? <><button className="link btn-danger" onClick={() => { setOrders((os) => os.filter((x) => x.id !== o.id)); setBorrar(null); }}>Confirmar borrar</button><button className="link" onClick={() => setBorrar(null)}>Cancelar</button></>
                : <button className="link btn-danger" onClick={() => setBorrar(o.id)}>Borrar</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MapEditor({ title, schema, parsed, overrides, onChange }) {
  return (
    <details className="adv">
      <summary>Columnas de {title}</summary>
      {Object.entries(schema).map(([k, def]) => (
        <label key={k} className="map-row">
          <span>{def.label}</span>
          <select className="select" value={overrides[k] || ''} onChange={(e) => onChange({ ...overrides, [k]: e.target.value || undefined })}>
            <option value="">Automático · {parsed.map[k] || 'ninguna'}</option>
            <option value="__none">No usar</option>
            {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      ))}
    </details>
  );
}

function SettingsPanel({ S, setS, uploads, setUploads, onUpload, remote, sources, parsedStock, parsedSales, model, todasBodegas }) {
  const num = (k, min = 0) => (e) => setS({ [k]: Math.max(min, +e.target.value || 0) });
  return (
    <div className="stack">
      <section className="settings-group">
        <h3>Conexión</h3>
        <div className="status-box">
          <div className="status-line"><span className={`dot ${sources.demo ? 'demo' : 'live'}`} /> <b>Stock:</b> {sources.stockSrc} · {n0(parsedStock.items.length)} etiquetas</div>
          <div className="status-line"><span className={`dot ${parsedSales.sales.length ? 'live' : 'demo'}`} /> <b>Ventas:</b> {sources.salesSrc || 'sin cargar'} · {n0(parsedSales.sales.length)} líneas</div>
          <div className="status-line"><span className={`dot ${remote.ranking ? 'live' : 'demo'}`} /> <b>Ranking:</b> {remote.ranking ? `Reporte de ${remote.ranking.mes} · ${remote.ranking.items.length} etiquetas` : 'sin reporte del mes pasado (uso las ventas)'}</div>
          {remote.at && <div className="small muted">Última lectura: {new Date(remote.at).toLocaleString('es-AR', { hour12: false })}</div>}
          {remote.errors?.map((e) => <div key={e} className="small" style={{ color: 'var(--urg)' }}>{e}</div>)}
        </div>
        {sources.demo && <p className="small muted">La app lee la planilla “2026 | AZARI WINES SRL”. En Vercel se conecta con la variable <code>GOOGLE_SHEET_ID</code> (ver README).</p>}
      </section>

      <section className="settings-group">
        <h3>Reglas de reposición</h3>
        <div className="grid2">
          <label className="field">Mínimo de cajas<input className="input" type="number" step="0.5" min="0" value={S.umbralCajas} onChange={num('umbralCajas')} /><span className="small muted">Debajo de esto se marca “Bajo”.</span></label>
          <label className="field">Pedir para cubrir (días)<input className="input" type="number" min="1" value={S.coberturaDias} onChange={num('coberturaDias', 1)} /><span className="small muted">Base de la cantidad sugerida.</span></label>
          <label className="field">Avisar si alcanza menos de (días)<input className="input" type="number" min="0" value={S.alertaDias} onChange={num('alertaDias')} /></label>
          <label className="field">Título del mensaje<input className="input" value={S.titulo} onChange={(e) => setS({ titulo: e.target.value })} /></label>
        </div>
      </section>

      <section className="settings-group">
        <h3>Bodegas fijadas arriba</h3>
        <div className="chips">
          {todasBodegas.map((b) => {
            const on = S.pinned.includes(b.nombre);
            return <button key={b.nombre} className="chip" aria-pressed={on} onClick={() => setS({ pinned: on ? S.pinned.filter((x) => x !== b.nombre) : [...S.pinned, b.nombre] })}>{on && <span className="star" aria-hidden="true">★</span>}{b.nombre}</button>;
          })}
        </div>
      </section>

      {model.sinMatch.length > 0 && (
        <section className="settings-group">
          <h3>Ventas sin etiqueta en el stock ({model.sinMatch.length})</h3>
          <p className="small muted">Se escriben distinto en ventas y en stock, así que no suman. Conviene unificar el nombre en la planilla.</p>
          <details className="adv"><summary>Ver lista</summary><ul className="small">{model.sinMatch.slice(0, 80).map((k) => <li key={k}>{k}</li>)}</ul></details>
        </section>
      )}

      <section className="settings-group">
        <h3>Avanzado</h3>
        <div className="grid2">
          <label className="upload">Subir stock a mano (xlsx/csv)
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onUpload('stock', e.target.files[0])} />
            {uploads?.stock && <span className="small muted">{uploads.stock.name} · {hace(uploads.stock.at)} · <button className="link" onClick={() => setUploads({ ...uploads, stock: null })}>quitar</button></span>}
          </label>
          <label className="upload">Subir ventas a mano (xlsx/csv)
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onUpload('sales', e.target.files[0])} />
            {uploads?.sales && <span className="small muted">{uploads.sales.name} · {hace(uploads.sales.at)} · <button className="link" onClick={() => setUploads({ ...uploads, sales: null })}>quitar</button></span>}
          </label>
        </div>
        <p className="small muted">La planilla conectada tiene prioridad sobre los archivos subidos.</p>
        <div className="grid2">
          <label className="field">El stock viene en
            <select className="select" value={S.stockUnit} onChange={(e) => setS({ stockUnit: e.target.value })}><option value="cajas">Cajas</option><option value="botellas">Botellas</option></select>
          </label>
          <label className="field">Las ventas vienen en
            <select className="select" value={S.salesUnit} onChange={(e) => setS({ salesUnit: e.target.value })}><option value="cajas">Cajas</option><option value="botellas">Botellas</option></select>
          </label>
        </div>
        <MapEditor title="stock" schema={STOCK_SCHEMA} parsed={parsedStock} overrides={S.stockMap} onChange={(m) => setS({ stockMap: m })} />
        <MapEditor title="ventas" schema={SALES_SCHEMA} parsed={parsedSales} overrides={S.salesMap} onChange={(m) => setS({ salesMap: m })} />
      </section>
    </div>
  );
}
