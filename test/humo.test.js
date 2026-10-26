// Prueba de humo SIN base de datos real: sustituye db.js por un simulador y comprueba
// validaciones, seguridad y la lógica de las rutas. Ejecutar:  npm test
process.env.JWT_SECRET = 'secreto-de-pruebas-de-mas-de-32-caracteres-xx';
const path = require('path');
const Module = require('module');
const jwt = require('jsonwebtoken');

// --- db simulada ---
const llamadas = [];
const usuarios = {
    1: { id_usuario: 1, nombre: 'Admin', estado: 1, rol: 'Administrador' },
    2: { id_usuario: 2, nombre: 'Cliente', estado: 1, rol: 'Cliente' },
    3: { id_usuario: 3, nombre: 'Inactivo', estado: 0, rol: 'Cliente' }
};
const productoActual = {
    id_producto: 5, nombre: 'Menta', descripcion: 'x', precio: '2.25', stock: 35, nivel_luz: 'Media',
    frecuencia_riego: 'Diario', tamano: 'Pequeño', uso: 'Huerto escolar', imagen: 'img/menta.png', estado: 1, id_categoria: 1
};
const dbFalsa = {
    async query(sql, params = []) {
        llamadas.push({ sql, params });
        if (sql.startsWith('CALL pa_obtener_usuario')) return [[[usuarios[params[0]]].filter(Boolean), {}]];
        if (sql.startsWith('CALL pa_detalle_producto')) return [[[params[0] === 5 ? productoActual : undefined].filter(Boolean), {}]];
        if (sql.startsWith('CALL pa_crear_pedido_completo')) return [[[{ id_pedido: 77 }], {}]];
        if (sql.startsWith('CALL pa_reporte_ventas')) return [[[{ total_pedidos: 3, ventas: '50.00' }], {}]];
        if (sql.startsWith('CALL pa_listar_categorias')) return [[[{ id_categoria: 1, nombre: 'Plantas', descripcion: 'x', productos: 7 }], {}]];
        if (sql.startsWith('CALL pa_listar_guias_publicas')) return [[[{ id_guia: 1, id_producto: 5, producto: 'Menta', titulo: 'T', contenido: 'C', tipo_guia: 'Cuidado' }], {}]];
        if (sql.startsWith('SELECT estado, cantidad')) return [[{ estado: 'Pendiente', cantidad: 2, monto: '10.00' }]];
        if (sql.startsWith('SELECT id_producto, nombre, unidades_vendidas')) return [[{ id_producto: 5, nombre: 'Menta', unidades_vendidas: 4, ingresos: '9.00' }]];
        if (sql.startsWith('SELECT periodo')) return [[{ periodo: '2026-10', total_pedidos: 3, ventas: '50.00' }]];
        if (sql.startsWith('CALL pa_cambiar_estado_pedido') && params[1] === 'Pendiente' && params[0] === 9) {
            const e = new Error('Transición de estado no permitida'); e.sqlState = '45000'; e.sqlMessage = e.message; throw e;
        }
        return [[[], {}]];
    }
};
const origResolve = Module._resolveFilename;
const rutaDb = path.resolve(__dirname, '..', 'db.js');
require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: dbFalsa };

// express-rate-limit puede no estar instalado todavía: se simula si falta
try { require.resolve('express-rate-limit'); } catch {
    Module._resolveFilename = function (req, ...r) { return req === 'express-rate-limit' ? 'erl-fake' : origResolve.call(this, req, ...r); };
    require.cache['erl-fake'] = { id: 'erl-fake', filename: 'erl-fake', loaded: true, exports: () => (rq, rs, next) => next() };
}

const app = require('../server');
const servidor = app.listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
const tokenDe = id => jwt.sign({ id, rol: 'x' }, process.env.JWT_SECRET, { expiresIn: '1h' });

let fallos = 0;
async function caso(nombre, metodo, ruta, { token, body, esperado, verifica } = {}) {
    const r = await fetch(base + ruta, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
    const datos = await r.json().catch(() => ({}));
    const ok = r.status === esperado && (!verifica || verifica(datos));
    if (!ok) fallos++;
    console.log(`${ok ? '✅' : '❌'} ${nombre} → ${r.status}${ok ? '' : ' (esperado ' + esperado + ') ' + JSON.stringify(datos)}`);
}

(async () => {
    // Registro
    await caso('registro: contraseña corta', 'POST', '/api/auth/registro', { body: { nombre: 'A', correo: 'a@b.co', contrasena: '123' }, esperado: 400 });
    await caso('registro: correo inválido', 'POST', '/api/auth/registro', { body: { nombre: 'A', correo: 'nope', contrasena: '12345678' }, esperado: 400 });
    await caso('registro: JSON roto', 'POST', '/api/auth/registro', { body: '{mal', esperado: 400 });
    // Seguridad de acceso
    await caso('admin sin token', 'GET', '/api/admin/dashboard', { esperado: 401 });
    await caso('admin con cliente', 'GET', '/api/admin/dashboard', { token: tokenDe(2), esperado: 403 });
    await caso('usuario desactivado con token vigente', 'GET', '/api/orders', { token: tokenDe(3), esperado: 401 });
    await caso('admin OK', 'GET', '/api/admin/pedidos?limite=5', { token: tokenDe(1), esperado: 200 });
    await caso('estado de pedido inválido', 'PUT', '/api/admin/pedidos/4/estado', { token: tokenDe(1), body: { nuevo_estado: 'Volando' }, esperado: 400 });
    await caso('transición no permitida (error de la BD → 400)', 'PUT', '/api/admin/pedidos/9/estado', { token: tokenDe(1), body: { nuevo_estado: 'Pendiente' }, esperado: 400 });
    await caso('no desactivarse a sí mismo', 'PUT', '/api/admin/usuarios/1/estado', { token: tokenDe(1), body: { estado: 0 }, esperado: 400 });
    await caso('estado de usuario fuera de rango', 'PUT', '/api/admin/usuarios/2/estado', { token: tokenDe(1), body: { estado: 7 }, esperado: 400 });
    // Catálogo
    await caso('filtro con luz inválida', 'GET', '/api/products?luz=Mucha', { esperado: 400 });
    await caso('producto con id basura', 'GET', '/api/products/abc', { esperado: 400 });
    await caso('producto inexistente', 'GET', '/api/products/999', { esperado: 404 });
    await caso('ruta /api inexistente', 'GET', '/api/nada', { esperado: 404 });
    // Pedidos
    await caso('pedido: domicilio sin dirección', 'POST', '/api/orders', { token: tokenDe(2), body: { tipo_entrega: 'Domicilio', items: [{ id_producto: 1, cantidad: 1 }] }, esperado: 400 });
    await caso('pedido: cantidad negativa', 'POST', '/api/orders', { token: tokenDe(2), body: { tipo_entrega: 'Retiro en la institución', items: [{ id_producto: 1, cantidad: -2 }] }, esperado: 400 });
    llamadas.length = 0;
    await caso('pedido: junta productos repetidos', 'POST', '/api/orders', {
        token: tokenDe(2), esperado: 201, verifica: d => d.id_pedido === 77,
        body: { tipo_entrega: 'Retiro en la institución', items: [{ id_producto: 3, cantidad: 1 }, { id_producto: 3, cantidad: 2 }] }
    });
    const llamadaPedido = llamadas.find(l => l.sql.startsWith('CALL pa_crear_pedido_completo'));
    const itemsEnviados = llamadaPedido && JSON.parse(llamadaPedido.params[3]);
    const okMerge = itemsEnviados && itemsEnviados.length === 1 && itemsEnviados[0].cantidad === 3;
    if (!okMerge) fallos++;
    console.log(`${okMerge ? '✅' : '❌'} pedido: el JSON enviado a MySQL quedó [{id:3,cantidad:3}]`);
    // Productos
    await caso('producto: precio negativo', 'POST', '/api/admin/productos', { token: tokenDe(1), body: { nombre: 'X', precio: -1 }, esperado: 400 });
    await caso('producto: tamaño inválido', 'POST', '/api/admin/productos', { token: tokenDe(1), body: { nombre: 'X', precio: 1, tamano: 'Gigante' }, esperado: 400 });
    llamadas.length = 0;
    await caso('PUT parcial de producto', 'PUT', '/api/admin/productos/5', { token: tokenDe(1), body: { precio: 3, stock: 10 }, esperado: 200 });
    const upd = llamadas.find(l => l.sql.startsWith('CALL pa_actualizar_producto'));
    // [id, nombre, descr, precio, stock, luz, riego, tamano, uso, imagen, estado, categoria]
    const okParcial = upd && upd.params[8] === 'Huerto escolar' && upd.params[6] === 'Diario' && upd.params[7] === 'Pequeño' && upd.params[9] === 'img/menta.png' && upd.params[3] === 3;
    if (!okParcial) fallos++;
    console.log(`${okParcial ? '✅' : '❌'} PUT parcial: conserva riego, tamaño, uso e imagen y cambia precio/stock`);
    // Reportes
    await caso('reporte: fecha inválida', 'GET', '/api/admin/reportes/ventas?desde=2026-13-45', { token: tokenDe(1), esperado: 400 });
    await caso('reporte: rango invertido', 'GET', '/api/admin/reportes/ventas?desde=2026-10-10&hasta=2026-10-01', { token: tokenDe(1), esperado: 400 });
    await caso('reporte ventas OK', 'GET', '/api/admin/reportes/ventas?desde=2026-10-01&hasta=2026-10-23', { token: tokenDe(1), esperado: 200, verifica: d => d.total_pedidos === 3 && d.ventas === '50.00' && d.resumen.total_pedidos === 3 && d.por_mes.length === 1 });
    await caso('más vendidos: límite inválido', 'GET', '/api/admin/reportes/mas-vendidos?limite=0', { token: tokenDe(1), esperado: 400 });

    // Rutas que usa el frontend nuevo
    await caso('tienda: /products/categorias (con descripción y conteo)', 'GET', '/api/products/categorias', { esperado: 200, verifica: d => d.categorias.length === 1 && d.categorias[0].productos === 7 });
    await caso('tienda: /products/guias/todas', 'GET', '/api/products/guias/todas', { esperado: 200, verifica: d => d.guias.length === 1 && d.guias[0].producto === 'Menta' });
    await caso('panel: /admin/reportes sin token', 'GET', '/api/admin/reportes', { esperado: 401 });
    await caso('panel: /admin/reportes combinado', 'GET', '/api/admin/reportes', { token: tokenDe(1), esperado: 200,
        verifica: d => d.ventas_por_mes.length === 1 && d.pedidos_por_estado[0].estado === 'Pendiente' && d.mas_vendidos[0].nombre === 'Menta' });

    servidor.close();
    console.log(fallos ? `\n❌ ${fallos} prueba(s) fallaron` : '\n🎉 Todas las pruebas pasaron');
    process.exit(fallos ? 1 : 0);
})();
