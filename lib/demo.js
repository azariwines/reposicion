// Datos de DEMO armados con el catálogo real de la plantilla de precios de Azari.
// Los números de stock y ventas son inventados: se reemplazan solos al conectar STOCK_CSV_URL.
const CAT = `Bodega Catena Zapata|Alamos Malbec|6
Bodega Catena Zapata|Nicasia Malbec|6
Bodega Catena Zapata|Nicasia Cab Franc|6
Bodega Catena Zapata|Nicasia Vineyard Gran Blend|6
Bodega Catena Zapata|Saint Felicien Malbec|6
Bodega Catena Zapata|Saint Felicien Cabernet Sau|6
Bodega Catena Zapata|Saint Felicien Pinot|6
Bodega Catena Zapata|DV Catena Cabernet-Malbec|6
Bodega Catena Zapata|DV Catena Malbec Malbec|6
Bodega Catena Zapata|DV Catena Chardonnay Chardonnay|6
Bodega Catena Zapata|Enemigo Malbec|6
Bodega Catena Zapata|Enemigo Cab Franc|6
Bodega Catena Zapata|Angelica Zapata Malbec|4
Bodega Catena Zapata|Angelica Zapata Cab Franc|4
Bodega Catena Zapata|Gran Enemigo Gualtallary|6
Bodega Catena Zapata|Gran Enemigo Chacayes|6
Bodega Catena Zapata|Nicolas Catena Zapata|6
Bodega Catena Zapata|Catena Appellation Vista Flores Malbec|6
Bodega Rutini Wines|Cruz Alta Malbec|6
Bodega Rutini Wines|Trumpeter Malbec|6
Bodega Rutini Wines|Trumpeter Cab Sauv|6
Bodega Rutini Wines|Trumpeter Reserva Malbec|6
Bodega Rutini Wines|Trumpeter Espumante Extra Brut|6
Bodega Rutini Wines|Rutini Encuentro Malbec|6
Bodega Rutini Wines|Rutini Cabernet-Malbec|6
Bodega Rutini Wines|Rutini Malbec|6
Bodega Rutini Wines|Rutini Chardonnay|6
Bodega Rutini Wines|Rutini Extra Brut|4
Bodega Rutini Wines|Apartado Gran Malbec|4
Bodega Salentein|KILLKA Malbec|6
Bodega Salentein|PYROS Pedernal Malbec|6
Bodega Salentein|Salentein Reserva Malbec|6
Bodega Salentein|Salentein Extra Brut|6
Bodega Salentein|Numina Malbec|6
Bodega Salentein|Numina Gran Corte|6
Bodega Salentein|Primus Malbec|6
Bodega Sottano|Sin Reglas Malbec|6
Bodega Sottano|Mil Demonios Malbec|6
Bodega Sottano|Colosso Malbec|6
Bodega Sottano|Gitano Blend|6
Bodega Sottano|Judas Malbec|6
Bodega Luigi Bosca|La Linda Malbec|6
Bodega Luigi Bosca|Luigi Bosca Malbec|6
Bodega Luigi Bosca|Luigi Bosca de Sangre Doc Malbec|6
Bodega Luigi Bosca|Luigi Bosca Extra Brut|6
Bodega Mosquita Muerta|Cordero con Piel de Lobo|6
Bodega Mosquita Muerta|Perro Callejero|6
Bodega Mosquita Muerta|Pispi|6
Bodega Mosquita Muerta|Sapo de Otro Pozo Blend de Tintas|6
Bodega Mosquita Muerta|Malcriado|3
Bodega Zuccardi|Santa Julia Malbec|6
Bodega Zuccardi|Zuccardi Serie A Malbec|6
Bodega Zuccardi|Zuccardi Q Malbec|6
Bodega Zuccardi|Zuccardi Concreto Malbec|6
Bodega Zuccardi|Jose Zuccardi Malbec|6
Bodega Laura - Ernesto Catena|Animal Orgánico Blend de Tintas|6
Bodega Laura - Ernesto Catena|Alma Negra Tinto|6
Bodega Laura - Ernesto Catena|Luca Malbec|6
Bodega Laura - Ernesto Catena|Siesta Malbec|6
Bodega Escorihuela Gascón|Escorihuela Gascón Malbec|6
Bodega Escorihuela Gascón|Escorihuela Gran Reserva Malbec|6
Bodega Escorihuela Gascón|Pequeñas Producciones Malbec|4
Bodega Escorihuela Gascón|Escorihuela The President Blend - Tinto|4
Bodega Chandon|Chandon Extra Brut|6
Bodega Chandon|Chandon Delice|6
Bodega Chandon|Baron B Extra Brut|6
Bodega Viña de Cobos|Felino Malbec|6
Bodega Viña de Cobos|Cocodrilo Corte|6
Bodega Viña de Cobos|Bramare Valle de Uco Malbec|6
Bodega Kaiken|Kaiken Estate Malbec|6
Bodega Kaiken|Kaiken Ultra Malbec|6
Bodega Durigutti|Durigutti Reserva Malbec|6
Bodega Durigutti|Durigutti Gran Reserva Cabernet Franc|6`;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function demoData() {
  const r = rng(20261103);
  const now = new Date();
  const stockRows = [];
  const salesRows = [];
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  CAT.split('\n').forEach((line, i) => {
    const [bodega, producto, uxc] = line.split('|');
    const pc = +uxc;
    const popular = r();
    const perMonth = popular > 0.8 ? 30 + Math.floor(r() * 40) : popular > 0.4 ? 6 + Math.floor(r() * 20) : Math.floor(r() * 6);
    // stock: algunos en 0, varios bajos, el resto ok
    const t = r();
    const stock = t < 0.14 ? 0 : t < 0.38 ? Math.floor(r() * pc * 2) : Math.floor(pc * (2 + r() * 8));
    stockRows.push({ BODEGA: bodega, PRODUCTO: producto, UNIDADES: pc, STOCK: Math.round((stock / pc) * 2) / 2 }); // en cajas
    // ventas de los últimos 4 meses
    for (let m = 3; m >= 0; m--) {
      const cuantos = Math.round(perMonth * (0.6 + r() * 0.8) * (m === 0 ? now.getDate() / 30 : 1));
      let left = cuantos;
      while (left > 0) {
        const q = Math.min(left, 1 + Math.floor(r() * 6));
        left -= q;
        const d = new Date(now.getFullYear(), now.getMonth() - m, 1 + Math.floor(r() * (m === 0 ? now.getDate() : 28)), 12);
        salesRows.push({ Fecha: fmt(d), Producto: producto, Cantidad: q });
      }
    }
  });
  const combos = [
    { id: 'demo-r1', grupo: 'Recomendadas', nombre: 'RECOMENDADOS AZARI 1', detalle: '', armadas: 2, items: ['Cordero con Piel de Lobo', 'Perro Callejero', 'Santa Julia Malbec', 'Alamos Malbec', 'Sin Reglas Malbec', 'Kaiken Estate Malbec'] },
    { id: 'demo-r2', grupo: 'Recomendadas', nombre: 'RECOMENDADOS AZARI 2 - ALTA GAMA', detalle: '', armadas: 0, items: ['Felino Malbec', 'Luca Malbec', 'Alma Negra Tinto', 'Numina Gran Corte', 'Durigutti Gran Reserva Cabernet Franc', 'Escorihuela Gran Reserva Malbec'] },
    { id: 'demo-es1', grupo: 'Essentials', nombre: 'Combo Essential I', detalle: '', armadas: 3, items: ['DV Catena Cabernet-Malbec', 'Enemigo Malbec', 'Angelica Zapata Malbec', 'Nicasia Malbec', 'Nicasia Vineyard Gran Blend', 'Saint Felicien Pinot'] },
    { id: 'demo-as1', grupo: 'Signature', nombre: 'Azari Signature I', detalle: '', armadas: 1, items: ['Nicolas Catena Zapata', 'Apartado Gran Malbec', 'Escorihuela The President Blend - Tinto', 'Gran Enemigo Gualtallary'] },
    { id: 'demo-m1', grupo: 'Mystery Box', nombre: 'Mystery BOX I - Descubre el secreto', detalle: '', armadas: 5, items: ['Mil Demonios Malbec', 'Colosso Malbec', 'Pispi', 'Zuccardi Q Malbec', 'Kaiken Ultra Malbec', 'Luigi Bosca Malbec'] },
  ];
  return { stockRows, salesRows, combos };
}
