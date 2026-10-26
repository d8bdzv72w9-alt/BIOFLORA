// ===== BIOFLORA · Panel de administración =====
// La seguridad real está en el backend (middleware de administrador);
// esta comprobación solo evita mostrar un panel vacío a quien no es admin.
if (!sesion.token || sesion.rol !== 'Administrador') {
    alert('Acceso denegado. Debes iniciar sesión como Administrador.');
    location.href = 'index.html';
}

const $ = (id) => document.getElementById(id);
const ESTADOS = ['Pendiente', 'En preparación', 'Entregado', 'Cancelado'];
const COLOR_ESTADO = { 'Pendiente': '#F4C040', 'En preparación': '#5B8A72', 'Entregado': '#1A432A', 'Cancelado': '#E87A90' };

let productos = [], categorias = [], guias = [], usuarios = [], pedidos = [];
let idEditando = null, estadoPedidoFiltro = '';

const errorAviso = (e) => mostrarAviso(e.message, 'error');
const filaVacia = (cols, texto) => `<tr><td colspan="${cols}" style="text-align:center;color:#667068;padding:28px">${texto}</td></tr>`;
const coincide = (texto, q) => String(texto).toLowerCase().includes(q.toLowerCase());

// ======================= NAVEGACIÓN =======================
const TITULOS = { panel: 'Panel de administración', productos: 'Productos', categorias: 'Categorías', guias: 'Guías de cuidado', pedidos: 'Pedidos', usuarios: 'Usuarios', reportes: 'Reportes' };
const CARGADORES = { panel: cargarPanel, productos: cargarProductos, categorias: cargarCategorias, guias: cargarGuias, pedidos: cargarPedidos, usuarios: cargarUsuarios, reportes: cargarReportes };

function irAVista(vista) {
    document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== 'vista-' + vista; });
    document.querySelectorAll('#adm-menu a[data-vista]').forEach(a => a.classList.toggle('activo', a.dataset.vista === vista));
    $('titulo-vista').textContent = TITULOS[vista];
    cerrarMenuMovil();
    CARGADORES[vista]();
}
document.querySelector('#adm-menu').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-vista]');
    if (a) irAVista(a.dataset.vista);
});
function cerrarMenuMovil() {
    $('adm-menu').classList.remove('abierto'); $('adm-fondo').classList.remove('abierto');
    $('btn-menu-adm').setAttribute('aria-expanded', 'false'); sincronizarScroll();
}
function abrirMenuMovil() {
    $('adm-menu').classList.add('abierto'); $('adm-fondo').classList.add('abierto');
    $('btn-menu-adm').setAttribute('aria-expanded', 'true'); sincronizarScroll();
}
$('btn-menu-adm').addEventListener('click', abrirMenuMovil);
$('adm-cerrar').addEventListener('click', cerrarMenuMovil);
$('adm-fondo').addEventListener('click', cerrarMenuMovil);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenuMovil(); });
window.matchMedia('(min-width: 981px)').addEventListener('change', (m) => { if (m.matches) cerrarMenuMovil(); });

// En celular las tablas se muestran como tarjetas: cada celda toma su etiqueta del encabezado (th)
function etiquetarTablas() {
    document.querySelectorAll('table').forEach(t => {
        const cab = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
        t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => {
            if (!td.hasAttribute('colspan') && cab[i]) td.dataset.label = cab[i];
        }));
    });
}
let _etq;
new MutationObserver(() => { cancelAnimationFrame(_etq); _etq = requestAnimationFrame(etiquetarTablas); })
    .observe(document.body, { childList: true, subtree: true });
$('btn-salir').addEventListener('click', () => { sesion.borrar(); location.href = 'index.html'; });

// ======================= GRÁFICOS SIN LIBRERÍAS =======================
function graficoBarras(items) {
    if (!items.length) return '<p class="vacio">Aún no hay ventas registradas.</p>';
    const max = Math.max(...items.map(i => Number(i.ventas)), 1);
    return `<div class="grafico">${items.map(i => `
        <div class="col"><div class="area"><div class="barra-v" style="height:${Math.max(3, (Number(i.ventas) / max) * 100)}%"><span class="val">${dinero(i.ventas)}</span></div></div>
        <span class="eti">${esc(i.periodo)}</span></div>`).join('')}</div>`;
}

function donut(items) {
    const total = items.reduce((s, i) => s + Number(i.cantidad), 0);
    if (!total) return '<p class="vacio">Sin pedidos todavía.</p>';
    let acumulado = 0;
    const tramos = items.map(i => {
        const ini = acumulado; acumulado += (Number(i.cantidad) / total) * 100;
        return `${COLOR_ESTADO[i.estado] || '#999'} ${ini}% ${acumulado}%`;
    }).join(', ');
    return `<div class="donut-wrap"><div class="donut" data-total="${total}" style="background:conic-gradient(${tramos})"></div>
        <div class="leyenda">${items.map(i => `<span><i style="background:${COLOR_ESTADO[i.estado] || '#999'}"></i>${esc(i.estado)}: <strong>${esc(i.cantidad)}</strong></span>`).join('')}</div></div>`;
}

function barrasHorizontales(items, etiqueta, valor, formato) {
    const max = Math.max(...items.map(valor), 1);
    return items.map(i => `<div class="barra"><span>${esc(etiqueta(i))}</span><div class="barra-fondo"><div class="barra-relleno" style="width:${(valor(i) / max) * 100}%"></div></div><b>${formato(valor(i))}</b></div>`).join('')
        || '<p class="vacio">Sin datos todavía.</p>';
}

// ======================= PANEL =======================
async function cargarPanel() {
    try {
        const [dash, rep, ped, prod] = await Promise.all([
            api('/admin/dashboard', { auth: true }),
            api('/admin/reportes', { auth: true }),
            api('/admin/pedidos', { auth: true }),
            api('/admin/productos', { auth: true }).catch(() => null)
        ]);
        const d = dash.datos;
        $('stat-ventas').textContent = dinero(d.ventas_mes);
        $('stat-pedidos').textContent = d.pedidos_mes;
        $('stat-productos').textContent = d.productos_activos;
        $('stat-clientes').textContent = d.clientes;
        $('dash-ventas').innerHTML = graficoBarras(rep.ventas_por_mes);
        $('dash-estados').innerHTML = donut(rep.pedidos_por_estado);
        pedidos = ped.pedidos;
        actualizarBadgePedidos();
        $('tabla-recientes').innerHTML = pedidos.slice(0, 5).map(p => `
            <tr><td><strong>${esc(p.id_pedido)}</strong></td><td>${esc(p.cliente)}</td><td>${fechaCorta(p.fecha)}</td><td>${dinero(p.total)}</td><td>${chipEstado(p.estado)}</td></tr>`).join('') || filaVacia(5, 'Sin pedidos todavía.');
        if (prod) {
            productos = prod.productos;
            const bajos = productos.filter(p => p.estado === 1 && p.stock <= 5).sort((a, b) => a.stock - b.stock).slice(0, 6);
            $('dash-stock').innerHTML = bajos.map(p => `<div class="alerta-fila"><span>${emojiProducto(p)} ${esc(p.nombre)}</span><span class="chip ${p.stock === 0 ? 'chip-Cancelado' : 'chip-Pendiente'}">${p.stock} u.</span></div>`).join('')
                || '<p class="vacio">Todo el inventario está en buen nivel 🌿</p>';
        } else {
            $('dash-stock').innerHTML = '<p class="vacio">Ejecuta actualizaciones.sql para ver el stock.</p>';
        }
    } catch (e) { errorAviso(e); }
}

function actualizarBadgePedidos() {
    const n = pedidos.filter(p => p.estado === 'Pendiente').length;
    $('badge-pedidos').textContent = n;
    $('badge-pedidos').hidden = n === 0;
}

// ======================= CATEGORÍAS (RF-04) =======================
async function cargarCategorias() {
    try {
        categorias = (await api('/products/categorias')).categorias;
        $('tabla-categorias').innerHTML = categorias.map(c => `
            <tr><td><strong>${EMOJI_CATEGORIA[c.id_categoria] || '🌿'} ${esc(c.nombre)}</strong></td><td>${esc(c.descripcion || '')}</td><td>${esc(c.productos)}</td>
            <td class="acc"><button class="btn btn-fantasma btn-sm" data-accion="editar-categoria" data-id="${esc(c.id_categoria)}">Editar</button>
            <button class="btn btn-peligro-f btn-sm" data-accion="borrar-categoria" data-id="${esc(c.id_categoria)}">Eliminar</button></td></tr>`).join('') || filaVacia(4, 'Sin categorías.');
    } catch (e) { errorAviso(e); }
}

function abrirCategoria(c) {
    idEditando = c ? c.id_categoria : null;
    $('categoria-titulo').textContent = c ? 'Editar categoría' : 'Nueva categoría';
    $('c-nombre').value = c ? c.nombre : '';
    $('c-descripcion').value = c ? (c.descripcion || '') : '';
    abrirModal('modal-categoria');
}

$('btn-guardar-categoria').addEventListener('click', async () => {
    const cuerpo = { nombre: $('c-nombre').value.trim(), descripcion: $('c-descripcion').value.trim() };
    if (!cuerpo.nombre) return mostrarAviso('El nombre es obligatorio', 'error');
    try {
        await api(idEditando ? `/admin/categorias/${idEditando}` : '/admin/categorias', { metodo: idEditando ? 'PUT' : 'POST', cuerpo, auth: true });
        mostrarAviso('Categoría guardada');
        cerrarModal('modal-categoria');
        cargarCategorias();
    } catch (e) { errorAviso(e); }
});

// ======================= PRODUCTOS (RF-03) =======================
async function cargarProductos() {
    try {
        if (!categorias.length) categorias = (await api('/products/categorias')).categorias;
        productos = (await api('/admin/productos', { auth: true })).productos;
        $('filtro-cat-producto').innerHTML = '<option value="">Todas las categorías</option>' + categorias.map(c => `<option value="${esc(c.id_categoria)}">${esc(c.nombre)}</option>`).join('');
        renderProductos();
    } catch (e) { errorAviso(e); }
}

function renderProductos() {
    const q = $('buscar-productos').value.trim(), cat = $('filtro-cat-producto').value, est = $('filtro-estado-producto').value;
    const lista = productos.filter(p => (!q || coincide(p.nombre, q)) && (!cat || String(p.id_categoria) === cat) && (est === '' || String(p.estado) === est));
    $('tabla-productos').innerHTML = lista.map(p => `
        <tr><td><div class="celda-prod"><div class="mini">${emojiProducto(p)}</div><div><strong>${esc(p.nombre)}</strong><br><small>${esc(p.uso || '')}</small></div></div></td>
        <td>${esc(p.categoria)}</td><td>${dinero(p.precio)}</td>
        <td><span class="stock-n ${p.stock <= 5 ? 'bajo' : ''}">${esc(p.stock)}</span></td>
        <td><span class="chip ${p.estado === 1 ? 'chip-ok' : 'chip-off'}">${p.estado === 1 ? 'Activo' : 'Inactivo'}</span></td>
        <td class="acc"><button class="btn btn-fantasma btn-sm" data-accion="editar-producto" data-id="${esc(p.id_producto)}">Editar</button>
        <button class="btn btn-peligro-f btn-sm" data-accion="borrar-producto" data-id="${esc(p.id_producto)}">Eliminar</button></td></tr>`).join('') || filaVacia(6, 'No hay productos con ese criterio.');
}
['buscar-productos', 'filtro-cat-producto', 'filtro-estado-producto'].forEach(id => $(id).addEventListener(id.startsWith('buscar') ? 'input' : 'change', renderProductos));

function abrirProducto(p) {
    idEditando = p ? p.id_producto : null;
    $('producto-titulo').textContent = p ? 'Editar producto' : 'Nuevo producto';
    $('p-categoria').innerHTML = categorias.map(c => `<option value="${esc(c.id_categoria)}">${esc(c.nombre)}</option>`).join('');
    $('p-nombre').value = p ? p.nombre : '';
    $('p-precio').value = p ? p.precio : '';
    $('p-stock').value = p ? p.stock : 0;
    $('p-categoria').value = p ? p.id_categoria : (categorias[0] ? categorias[0].id_categoria : '');
    $('p-descripcion').value = p ? (p.descripcion || '') : '';
    $('p-luz').value = p ? (p.nivel_luz || '') : '';
    $('p-riego').value = p ? (p.frecuencia_riego || '') : '';
    $('p-tamano').value = p ? (p.tamano || '') : '';
    $('p-uso').value = p ? (p.uso || '') : '';
    $('p-imagen').value = p ? (p.imagen || '') : '';
    $('p-activo').checked = p ? p.estado === 1 : true;
    abrirModal('modal-producto');
}

$('btn-guardar-producto').addEventListener('click', async () => {
    const cuerpo = {
        nombre: $('p-nombre').value.trim(), precio: $('p-precio').value, stock: $('p-stock').value, id_categoria: $('p-categoria').value,
        descripcion: $('p-descripcion').value, nivel_luz: $('p-luz').value, frecuencia_riego: $('p-riego').value,
        tamano: $('p-tamano').value, uso: $('p-uso').value, imagen: $('p-imagen').value, estado: $('p-activo').checked ? 1 : 0
    };
    if (!cuerpo.nombre || cuerpo.precio === '') return mostrarAviso('El nombre y el precio son obligatorios', 'error');
    try {
        await api(idEditando ? `/admin/productos/${idEditando}` : '/admin/productos', { metodo: idEditando ? 'PUT' : 'POST', cuerpo, auth: true });
        mostrarAviso(idEditando ? 'Producto actualizado' : 'Producto creado');
        cerrarModal('modal-producto');
        cargarProductos();
    } catch (e) { errorAviso(e); }
});

// ======================= GUÍAS (RF-05) =======================
async function cargarGuias() {
    try {
        guias = (await api('/admin/guias', { auth: true })).guias;
        renderGuias();
    } catch (e) { errorAviso(e); }
}

function renderGuias() {
    const q = $('buscar-guias').value.trim();
    const lista = guias.filter(g => !q || coincide(g.titulo + ' ' + g.producto, q));
    $('tabla-guias').innerHTML = lista.map(g => `
        <tr><td>${esc(g.producto)}</td><td><strong>${esc(g.titulo)}</strong></td><td>${esc(g.tipo_guia)}</td><td>${esc(g.nivel_dificultad || '')}</td>
        <td class="acc"><button class="btn btn-fantasma btn-sm" data-accion="editar-guia" data-id="${esc(g.id_guia)}">Editar</button>
        <button class="btn btn-peligro-f btn-sm" data-accion="borrar-guia" data-id="${esc(g.id_guia)}">Eliminar</button></td></tr>`).join('') || filaVacia(5, 'Sin guías.');
}
$('buscar-guias').addEventListener('input', renderGuias);

async function abrirGuia(g) {
    idEditando = g ? g.id_guia : null;
    try { if (!productos.length) productos = (await api('/admin/productos', { auth: true })).productos; } catch (e) { return errorAviso(e); }
    $('guia-titulo-modal').textContent = g ? 'Editar guía' : 'Nueva guía de cuidado';
    $('g-producto').innerHTML = productos.map(p => `<option value="${esc(p.id_producto)}">${esc(p.nombre)}</option>`).join('');
    if (g) $('g-producto').value = g.id_producto;
    $('g-producto').disabled = !!g; // el producto de una guía no se cambia al editar
    $('g-titulo').value = g ? g.titulo : '';
    $('g-tipo').value = g ? g.tipo_guia : 'Cuidado';
    $('g-nivel').value = g ? (g.nivel_dificultad || 'Fácil') : 'Fácil';
    $('g-contenido').value = g ? g.contenido : '';
    abrirModal('modal-guia');
}

$('btn-guardar-guia').addEventListener('click', async () => {
    const cuerpo = { id_producto: $('g-producto').value, titulo: $('g-titulo').value.trim(), tipo_guia: $('g-tipo').value, nivel_dificultad: $('g-nivel').value, contenido: $('g-contenido').value.trim() };
    if (!cuerpo.titulo || !cuerpo.contenido) return mostrarAviso('Título y contenido son obligatorios', 'error');
    try {
        await api(idEditando ? `/admin/guias/${idEditando}` : '/admin/guias', { metodo: idEditando ? 'PUT' : 'POST', cuerpo, auth: true });
        mostrarAviso('Guía guardada');
        cerrarModal('modal-guia');
        cargarGuias();
    } catch (e) { errorAviso(e); }
});

// ======================= PEDIDOS (RF-12) =======================
async function cargarPedidos() {
    try {
        pedidos = (await api('/admin/pedidos' + (estadoPedidoFiltro ? '?estado=' + encodeURIComponent(estadoPedidoFiltro) : ''), { auth: true })).pedidos;
        if (!estadoPedidoFiltro) actualizarBadgePedidos();
        renderPedidos();
    } catch (e) { errorAviso(e); }
}

function renderPedidos() {
    const q = $('buscar-pedidos').value.trim();
    const lista = pedidos.filter(p => !q || coincide(`${p.id_pedido} ${p.cliente} ${p.correo}`, q));
    $('tabla-pedidos').innerHTML = lista.map(p => `
        <tr><td><a href="#" data-accion="ver-pedido" data-id="${esc(p.id_pedido)}" style="color:var(--verde);font-weight:700">#${esc(p.id_pedido)}</a></td>
        <td>${esc(p.cliente)}<br><small>${esc(p.correo)}</small></td><td>${fechaCorta(p.fecha)}</td>
        <td>${esc(p.tipo_entrega)}${p.direccion_entrega ? '<br><small>' + esc(p.direccion_entrega) + '</small>' : ''}</td>
        <td><strong>${dinero(p.total)}</strong></td><td>${chipEstado(p.estado)}</td>
        <td>${p.estado === 'Cancelado' ? '—' : `<select data-accion="cambiar-estado" data-id="${esc(p.id_pedido)}" style="width:auto;padding:6px">${ESTADOS.map(s => `<option ${s === p.estado ? 'selected' : ''}>${s}</option>`).join('')}</select>`}</td></tr>`).join('') || filaVacia(7, 'No hay pedidos.');
}
$('buscar-pedidos').addEventListener('input', renderPedidos);

async function cambiarEstado(id, nuevo) {
    if (nuevo === 'Cancelado' && !(await confirmar(`Se devolverá el stock y el pedido #${id} no podrá reactivarse.`, { titulo: '¿Cancelar el pedido?', si: 'Cancelar pedido', peligro: true }))) return cargarPedidos();
    try {
        await api(`/admin/pedidos/${id}/estado`, { metodo: 'PUT', cuerpo: { nuevo_estado: nuevo }, auth: true });
        mostrarAviso(`Pedido #${id}: ${nuevo}`);
    } catch (e) { errorAviso(e); }
    cargarPedidos();
}

async function verPedido(id) {
    $('dp-titulo').textContent = `Pedido #${id}`;
    $('dp-contenido').innerHTML = '<p class="cargando">Cargando…</p>';
    abrirModal('modal-detalle-pedido');
    try {
        const { detalles } = await api('/admin/pedidos/' + id, { auth: true });
        $('dp-contenido').innerHTML = `<table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${detalles.map(d =>
            `<tr><td>${esc(d.nombre)}</td><td>${esc(d.cantidad)}</td><td>${dinero(d.precio_unitario)}</td><td>${dinero(d.subtotal)}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) { $('dp-contenido').innerHTML = `<p class="vacio">${esc(e.message)}</p>`; }
}

// ======================= USUARIOS (RF-13) =======================
async function cargarUsuarios() {
    try {
        usuarios = (await api('/admin/usuarios', { auth: true })).usuarios;
        renderUsuarios();
    } catch (e) { errorAviso(e); }
}

function renderUsuarios() {
    const q = $('buscar-usuarios').value.trim();
    const lista = usuarios.filter(u => !q || coincide(u.nombre + ' ' + u.correo, q));
    $('tabla-usuarios').innerHTML = lista.map(u => `
        <tr><td><div class="celda-prod"><span class="avatar" style="background:var(--verde);color:#fff">${esc(u.nombre.charAt(0).toUpperCase())}</span><div><strong>${esc(u.nombre)}</strong><br><small>${esc(u.correo)}</small></div></div></td>
        <td>${esc(u.rol)}</td><td>${fechaCorta(u.fecha_registro)}</td>
        <td><span class="chip ${u.estado === 1 ? 'chip-ok' : 'chip-off'}">${u.estado === 1 ? 'Activo' : 'Inactivo'}</span></td>
        <td><button class="btn ${u.estado === 1 ? 'btn-peligro-f' : 'btn-fantasma'} btn-sm" data-accion="estado-usuario" data-id="${esc(u.id_usuario)}" data-estado="${u.estado === 1 ? 0 : 1}">${u.estado === 1 ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') || filaVacia(5, 'No hay usuarios con ese criterio.');
}
$('buscar-usuarios').addEventListener('input', renderUsuarios);

// ======================= REPORTES (RF-14) =======================
async function cargarReportes() {
    try {
        const r = await api('/admin/reportes', { auth: true });
        $('rep-ventas').innerHTML = graficoBarras(r.ventas_por_mes);
        $('rep-estados').innerHTML = donut(r.pedidos_por_estado);
        $('rep-top').innerHTML = barrasHorizontales(r.mas_vendidos, i => i.nombre, i => Number(i.unidades_vendidas), n => n + ' u.');
    } catch (e) { errorAviso(e); }
}

$('btn-rep-rango').addEventListener('click', async () => {
    const desde = $('rep-desde').value, hasta = $('rep-hasta').value;
    if (!desde || !hasta) return mostrarAviso('Elige las dos fechas', 'error');
    try {
        const r = await api(`/admin/reportes/ventas?desde=${desde}&hasta=${hasta}`, { auth: true });
        $('rep-rango-resultado').hidden = false;
        $('rep-rango-resultado').innerHTML = `Del <strong>${esc(desde)}</strong> al <strong>${esc(hasta)}</strong>: <strong>${esc(r.total_pedidos)}</strong> pedidos · <strong>${dinero(r.ventas)}</strong> en ventas`;
    } catch (e) { errorAviso(e); }
});

// ======================= ACCIONES (delegación de eventos) =======================
document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-accion]');
    if (!el || el.tagName === 'SELECT') return;
    e.preventDefault();
    const id = Number(el.dataset.id);
    switch (el.dataset.accion) {
        case 'nuevo-producto': abrirProducto(null); break;
        case 'editar-producto': abrirProducto(productos.find(p => p.id_producto === id)); break;
        case 'borrar-producto':
            if (!(await confirmar('Si el producto ya tiene pedidos solo se desactivará; si no, se eliminará.', { titulo: '¿Eliminar producto?', si: 'Eliminar', peligro: true }))) break;
            try { const r = await api('/admin/productos/' + id, { metodo: 'DELETE', auth: true }); mostrarAviso(r.mensaje); cargarProductos(); } catch (err) { errorAviso(err); }
            break;
        case 'nueva-categoria': abrirCategoria(null); break;
        case 'editar-categoria': abrirCategoria(categorias.find(c => c.id_categoria === id)); break;
        case 'borrar-categoria':
            if (!(await confirmar('Solo se puede eliminar si no tiene productos asociados.', { titulo: '¿Eliminar categoría?', si: 'Eliminar', peligro: true }))) break;
            try { await api('/admin/categorias/' + id, { metodo: 'DELETE', auth: true }); mostrarAviso('Categoría eliminada'); cargarCategorias(); } catch (err) { errorAviso(err); }
            break;
        case 'nueva-guia': abrirGuia(null); break;
        case 'editar-guia': abrirGuia(guias.find(g => g.id_guia === id)); break;
        case 'borrar-guia':
            if (!(await confirmar('La guía dejará de mostrarse en la tienda.', { titulo: '¿Eliminar guía?', si: 'Eliminar', peligro: true }))) break;
            try { await api('/admin/guias/' + id, { metodo: 'DELETE', auth: true }); mostrarAviso('Guía eliminada'); cargarGuias(); } catch (err) { errorAviso(err); }
            break;
        case 'estado-pedido':
            estadoPedidoFiltro = el.dataset.valor;
            document.querySelectorAll('#pills-pedidos .pill').forEach(b => b.classList.toggle('activo', b === el));
            cargarPedidos();
            break;
        case 'ver-pedido': verPedido(id); break;
        case 'estado-usuario':
            try { await api(`/admin/usuarios/${id}/estado`, { metodo: 'PUT', cuerpo: { estado: Number(el.dataset.estado) }, auth: true }); mostrarAviso('Usuario actualizado'); cargarUsuarios(); } catch (err) { errorAviso(err); }
            break;
    }
});
document.addEventListener('change', (e) => {
    const el = e.target.closest('select[data-accion="cambiar-estado"]');
    if (el) cambiarEstado(Number(el.dataset.id), el.value);
});

// ======================= INICIO =======================
$('nombre-admin').textContent = sesion.nombre || 'Administrador';
$('avatar-admin').textContent = sesion.inicial;
hidratarIconos();
irAVista('panel');