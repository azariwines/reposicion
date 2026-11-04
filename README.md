# Azari · Reposición

App interna para ver qué reponer y armar pedidos a bodegas listos para pegar en el grupo de WhatsApp.

## Qué hace

- **Bodegas principales** arriba (las que más venden + las que fijes con ★), con cuántas etiquetas hay que reponer y cuántas urgentes.
- **Filtro por bodega y buscador.** La lista viene ordenada por prioridad:
  1. **Urgente**: stock en 0 y se vendió el mes pasado o este mes.
  2. **Agotado**: stock en 0.
  3. **Menos de 1 caja**.
  4. **Bajo**: debajo del mínimo (por defecto 2 cajas).
  5. **Se acaba pronto**: al ritmo de venta no llega a 15 días.
- Por cada etiqueta: stock en cajas y botellas, vendido el mes pasado, vendido este mes y **cobertura en días**.
- **Cantidad sugerida**: lo que hace falta para cubrir 30 días al ritmo de venta de los últimos 3 meses, nunca por debajo del mínimo de cajas.
- **Armar pedido**: sumás cajas con + / −, o “Agregar sugeridos” de toda la lista. Sale el mensaje agrupado por bodega para **copiar** o **abrir en WhatsApp**. También se puede copiar el pedido de una sola bodega.
- **Historial**: cuando tocás “Ya lo mandé”, el pedido queda guardado y esas etiquetas se marcan como “Pedido X cj · hace N días” para no pedirlas dos veces. Después lo marcás como recibido.
- Se actualiza sola cada 60 segundos y cada vez que volvés a la pestaña.

## Subirlo (GitHub + Vercel)

1. Subí esta carpeta a un repo nuevo de GitHub.
2. En Vercel: **Add New → Project → importá el repo**. Vercel reconoce Next.js solo; no hace falta tocar nada.
3. Cargá las variables (ver abajo) y hacé **Redeploy**. Usá un repo **privado**.

Sin variables, la app arranca en **MODO DEMO** con el catálogo real de la plantilla de precios y números inventados.

## Conectarlo a la planilla de Azari (stock + ventas en vivo)

La app lee directo la planilla **“2026 | AZARI WINES SRL”**, sin publicar nada aparte:

- **Stock:** hoja `STOCK 2026`. Toma las filas título de cada bodega (“BODEGA CATENA ZAPATA”) y debajo, de cada vino: **A** = etiqueta, **B** = botellas por caja, **C** = cajas en stock. Costos, precios y márgenes **no salen del servidor**: la app ni los recibe.
- **Ventas:** hojas `Ventas <Mes> <Año>` del mes actual y los 3 anteriores. Usa **FECHA**, **Cantidad** (en cajas) y **Etiqueta**. Los combos cuentan 1 botella de cada vino. El costo de envío y la fila de totales se ignoran.

Pasos:

1. En Vercel → Settings → Environment Variables cargá:
   - `GOOGLE_SHEET_ID` = `1rIGPovOixvgE7dvaZ7a2p2DFg3geATNv9jXhHnzj7n8`
   - `APP_PASSWORD` = la clave que quieran usar
2. Redeploy.

El stock se lee en cada carga (y cada 60 s con la app abierta), así que lo que se edite en la planilla aparece en segundos. Las ventas se refrescan cada 5 minutos.

**Cambio de año:** en enero la app busca sola `STOCK 2027` y `Ventas Enero 2027`. Si el archivo nuevo es otro, cambiás `GOOGLE_SHEET_ID`. Si la hoja de stock se llama distinto, usás `STOCK_SHEET_NAME`.

**Requisitos de la planilla:**
- Que siga compartida como “Cualquier persona con el enlace: Lector”.
- Que las etiquetas se escriban igual en el stock y en las ventas. Mayúsculas, tildes, emojis y añadas no importan. Si alguna no cruza, la app la lista en ⚙︎ Ajustes.
- Que una fila título de bodega tenga solo el nombre, con el resto de las columnas vacías.

> ⚠️ Con el link compartido, cualquiera que lo tenga ve costos y márgenes. La app no los expone, pero conviene que el repo de GitHub sea **privado** y que el link de la planilla no circule.

**Otras opciones:** subir un .xlsx a mano desde ⚙︎ Ajustes, o leer las ventas de Airtable (ver `.env.example`).

## Proteger con clave

Cargá `APP_PASSWORD` en Vercel. El navegador pide usuario y clave: cualquier usuario con esa clave.

## Correr local

```bash
npm install
cp .env.example .env.local   # completar
npm run dev                  # http://localhost:3000
```
