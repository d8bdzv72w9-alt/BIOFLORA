// ===== BIOFLORA · Tienda (una sola página con pestañas por hash: #/inicio, #/tienda...) =====
const $ = (id) => document.getElementById(id);

let carrito = [];
try { carrito = JSON.parse(localStorage.getItem('bioflora_carrito')) || []; } catch (e) { carrito = []; }

const mapaProductos = new Map();           // id -> producto (para agregar al carrito sin volver a pedirlo)
let catalogo = [], categorias = [], guiasTodas = null;
let pendiente = null;                      // producto que el invitado quiso agregar antes de ingresar
let filtroGuia = 'Todas';
const filtros = { texto: '', categoria: '', luz: '', riego: '', tamano: '', uso: '' };
const ETIQUETA_FILTRO = { texto: 'Búsqueda', categoria: 'Categoría', luz: 'Luz', riego: 'Riego', tamano: 'Tamaño', uso: 'Uso' };
const RUTAS = ['inicio', 'tienda', 'guias', 'nosotros', 'pedidos'];
const PASOS = ['Pendiente', 'En preparación', 'Entregado'];
const ICONO_GUIA = { Cuidado: 'droplet', Siembra: 'leaf', Reciclaje: 'recycle' };

// ======================= NAVEGACIÓN =======================
const rutaActual = () => {
    const r = (location.hash.replace('#/', '') || 'inicio').split('?')[0];
    return RUTAS.includes(r) ? r : 'inicio';
};

function mostrarVista() {
    let r = rutaActual();
    if (r === 'pedidos' && !sesion.token) {
        r = 'inicio';
        history.replaceState(null, '', '#/inicio');
        mostrarAviso('Inicia sesión para ver tus pedidos', 'error');
        abrirAuth('login');
    }
    document.querySelectorAll('.vista').forEach(v => { v.hidden = v.id !== 'vista-' + r; });
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('activo', a.dataset.ruta === r));
    cerrarNav();
    window.scrollTo(0, 0);
    if (r === 'inicio') cargarInicio();
    if (r === 'tienda') cargarCatalogo();
    if (r === 'guias') cargarGuias();
    if (r === 'pedidos') cargarPedidos();
}
window.addEventListener('hashchange', mostrarVista);

// ----- Menú móvil (hamburguesa): abre, cierra con X, fondo, enlace, Escape o al agrandar la pantalla -----
function abrirNav() {
    $('nav').classList.add('abierto'); $('nav-fondo').classList.add('abierto');
    $('btn-menu').setAttribute('aria-expanded', 'true'); sincronizarScroll();
}
function cerrarNav() {
    $('nav').classList.remove('abierto'); $('nav-fondo').classList.remove('abierto');
    $('btn-menu').setAttribute('aria-expanded', 'false'); sincronizarScroll();
}
$('btn-menu').addEventListener('click', () => ($('nav').classList.contains('abierto') ? cerrarNav() : abrirNav()));
$('nav-cerrar').addEventListener('click', cerrarNav);
$('nav-fondo').addEventListener('click', cerrarNav);
$('nav').addEventListener('click', (e) => { if (e.target.closest('a')) cerrarNav(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarNav(); });
window.matchMedia('(min-width: 981px)').addEventListener('change', (m) => { if (m.matches) cerrarNav(); });

// ======================= SESIÓN EN LA INTERFAZ =======================
function actualizarSesionUI() {
    const log = !!sesion.token;
    $('zona-invitado').hidden = log;
    $('zona-usuario').hidden = !log;
    $('nav-pedidos').hidden = !log;
    $('menu-usuario').hidden = true;
    document.querySelectorAll('.solo-invitado').forEach(e => { e.hidden = log; });
    document.querySelectorAll('.solo-usuario').forEach(e => { e.hidden = !log; });
    if (log) {
        $('avatar').textContent = sesion.inicial;
        $('usuario-nombre').textContent = sesion.nombre.split(' ')[0];
        $('menu-admin').hidden = sesion.rol !== 'Administrador';
    }
    $('hero-eyebrow').textContent = log ? `Hola, ${sesion.nombre.split(' ')[0]} 👋` : 'Florería sostenible y educativa';
}
$('btn-usuario').addEventListener('click', () => { $('menu-usuario').hidden = !$('menu-usuario').hidden; });

// ======================= TARJETAS =======================
function visualProducto(p, clase) {
    return `<span class="emoji">${emojiProducto(p)}</span>${p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy" onerror="this.remove()">` : ''}`;
}

function tarjetaProducto(p) {
    mapaProductos.set(p.id_producto, p);
    const agotado = p.stock <= 0, pocas = !agotado && p.stock <= 5;
    return `
    <article class="producto cat-${esc(p.id_categoria)}">
        <div class="producto-img" data-accion="detalle" data-id="${esc(p.id_producto)}">
            ${p.nivel_cuidado ? `<span class="insignia">${esc(p.nivel_cuidado)}</span>` : ''}
            ${agotado ? '<span class="stock-tag agotado">Agotado</span>' : pocas ? `<span class="stock-tag">¡Quedan ${esc(p.stock)}!</span>` : ''}
            ${visualProducto(p)}
        </div>
        <div class="producto-cuerpo">
            <span class="producto-cat">${esc(p.categoria)}</span>
            <h3 data-accion="detalle" data-id="${esc(p.id_producto)}">${esc(p.nombre)}</h3>
            <div class="producto-meta">
                ${p.nivel_luz ? `<span>${ic('sun')} ${esc(p.nivel_luz)}</span>` : ''}
                ${p.frecuencia_riego ? `<span>${ic('droplet')} ${esc(p.frecuencia_riego)}</span>` : ''}
                ${p.tamano ? `<span>${ic('leaf')} ${esc(p.tamano)}</span>` : ''}
            </div>
            <div class="producto-pie">
                <div class="precio">${dinero(p.precio)}</div>
                <div class="fila-botones">
                    <button class="btn btn-primario" data-accion="agregar" data-id="${esc(p.id_producto)}" ${agotado ? 'disabled' : ''}>${ic('cart')} Agregar</button>
                    <button class="btn btn-fantasma" data-accion="detalle" data-id="${esc(p.id_producto)}">Ver más</button>
                </div>
            </div>
        </div>
    </article>`;
}

// ======================= INICIO =======================
async function cargarInicio() {
    try {
        const [cat, prod, gui] = await Promise.all([
            api('/products/categorias'), api('/products'), api('/products/guias/todas').catch(() => ({ guias: [] }))
        ]);
        categorias = cat.categorias;
        guiasTodas = gui.guias;
        $('n-productos').textContent = prod.total;
        $('n-guias').textContent = gui.guias.length;
        $('n-categorias').textContent = cat.categorias.length;
        $('inicio-categorias').innerHTML = categorias.map(c => `
            <button class="cat-card" data-accion="ir-categoria" data-id="${esc(c.id_categoria)}">
                <span class="cat-emoji">${EMOJI_CATEGORIA[c.id_categoria] || '🌿'}</span>
                <strong>${esc(c.nombre)}</strong><small>${esc(c.descripcion || '')}</small><em>${esc(c.productos)} productos</em>
            </button>`).join('');
        const destacados = [...prod.productos].sort((a, b) => b.guias_disponibles - a.guias_disponibles).slice(0, 4);
        $('inicio-destacados').innerHTML = destacados.map(tarjetaProducto).join('');
    } catch (e) {
        $('inicio-destacados').innerHTML = `<p class="vacio">${esc(e.message)}</p>`;
        $('inicio-categorias').innerHTML = '';
    }
}

// ======================= TIENDA (RF-06, RF-07) =======================
const nombreCategoria = (id) => (categorias.find(c => String(c.id_categoria) === String(id)) || {}).nombre || id;

function sincronizarControles() {
    $('f-texto').value = filtros.texto;
    ['luz', 'riego', 'tamano', 'uso'].forEach(k => { $('f-' + k).value = filtros[k]; });
    $('pills-categoria').innerHTML =
        `<button class="pill ${filtros.categoria === '' ? 'activo' : ''}" data-accion="pill" data-valor="">Todos</button>` +
        categorias.map(c => `<button class="pill ${String(c.id_categoria) === filtros.categoria ? 'activo' : ''}" data-accion="pill" data-valor="${esc(c.id_categoria)}">${EMOJI_CATEGORIA[c.id_categoria] || ''} ${esc(c.nombre)}</button>`).join('');
    $('chips-activos').innerHTML = Object.entries(filtros).filter(([, v]) => v).map(([k, v]) =>
        `<button class="chip-filtro" data-accion="quitar-filtro" data-filtro="${k}">${ETIQUETA_FILTRO[k]}: ${esc(k === 'categoria' ? nombreCategoria(v) : v)} ${ic('x')}</button>`).join('');
}

async function cargarCatalogo() {
    if (!categorias.length) { try { categorias = (await api('/products/categorias')).categorias; } catch (e) { /* sigue sin categorías */ } }
    sincronizarControles();
    const params = new URLSearchParams();
    Object.entries(filtros).forEach(([k, v]) => { if (v) params.set(k, v); });
    $('grid-tienda').innerHTML = '<p class="cargando">Cargando productos…</p>';
    try {
        const datos = await api('/products?' + params.toString());
        catalogo = datos.productos;
        renderCatalogo();
    } catch (e) {
        $('grid-tienda').innerHTML = `<p class="vacio">${esc(e.message)}</p>`;
    }
}

function renderCatalogo() {
    const lista = [...catalogo];
    const orden = $('f-orden').value;
    if (orden === 'precio-asc') lista.sort((a, b) => a.precio - b.precio);
    if (orden === 'precio-desc') lista.sort((a, b) => b.precio - a.precio);
    $('resumen-tienda').textContent = `${lista.length} producto${lista.length === 1 ? '' : 's'} encontrado${lista.length === 1 ? '' : 's'}`;
    $('grid-tienda').innerHTML = lista.length
        ? lista.map(tarjetaProducto).join('')
        : `<div class="vacio"><div style="font-size:54px">🔎</div><p>No encontramos productos con esos filtros.</p><button class="btn btn-fantasma" data-accion="limpiar-filtros">Limpiar filtros</button></div>`;
}

let temporizadorBusqueda;
$('f-texto').addEventListener('input', () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => { filtros.texto = $('f-texto').value.trim(); cargarCatalogo(); }, 350);
});
['luz', 'riego', 'tamano', 'uso'].forEach(k => $('f-' + k).addEventListener('change', () => { filtros[k] = $('f-' + k).value; cargarCatalogo(); }));
$('f-orden').addEventListener('change', renderCatalogo);

// ======================= DETALLE DE PRODUCTO (RF-08) =======================
function formatearGuia(texto) {
    return esc(texto).replace(/\b(Luz|Riego|Cuidados):/g, '<br><strong>$1:</strong>').replace(/^<br>/, '');
}

async function verDetalle(id) {
    $('producto-contenido').innerHTML = '<p class="cargando">Cargando…</p>';
    abrirModal('modal-producto');
    try {
        const { producto: p, guias } = await api('/products/' + id);
        mapaProductos.set(p.id_producto, p);
        const agotado = p.stock <= 0, log = !!sesion.token;
        const etiquetas = [
            p.nivel_luz && `<span class="etiqueta amarilla">${ic('sun')} Luz ${esc(p.nivel_luz.toLowerCase())}</span>`,
            p.frecuencia_riego && `<span class="etiqueta">${ic('droplet')} Riego ${esc(p.frecuencia_riego.toLowerCase())}</span>`,
            p.tamano && `<span class="etiqueta">${ic('leaf')} ${esc(p.tamano)}</span>`,
            p.uso && `<span class="etiqueta rosa">${esc(p.uso)}</span>`
        ].filter(Boolean).join('');

        $('producto-contenido').innerHTML = `
            <div class="detalle">
                <div class="detalle-img cat-${esc(p.id_categoria)}"><span>${emojiProducto(p)}</span>${p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" onerror="this.remove()">` : ''}</div>
                <div>
                    <span class="eyebrow">${esc(p.categoria)}</span>
                    <h2 style="font-size:30px;margin-bottom:6px">${esc(p.nombre)}</h2>
                    <div class="precio-grande">${dinero(p.precio)}</div>
                    <p style="color:#667068">${esc(p.descripcion || '')}</p>
                    <div class="etiquetas">${etiquetas}</div>
                    <p style="font-size:13px;color:#667068">${agotado ? '<strong style="color:#b3354f">Agotado</strong>' : `Disponibles: <strong>${esc(p.stock)}</strong> unidades`}</p>
                    <button class="btn btn-primario btn-lg" data-accion="agregar" data-id="${esc(p.id_producto)}" ${agotado ? 'disabled' : ''}>${ic('cart')} ${log ? 'Agregar al carrito' : 'Ingresa para comprar'}</button>
                </div>
            </div>
            <h3 style="margin-top:28px">${ic('book')} Guías de este producto</h3>
            ${guias.length === 0 ? '<p style="color:#667068">Nuestro equipo está preparando la guía de este producto. ¡Vuelve pronto!</p>' : guias.map(g => `
                <div class="guia-bloque ${log ? '' : 'bloqueada'}">
                    <h4>${esc(g.titulo)} <span class="etiqueta">${esc(g.tipo_guia)}</span>${g.nivel_dificultad ? `<span class="etiqueta amarilla">${esc(g.nivel_dificultad)}</span>` : ''}</h4>
                    <div class="guia-texto">${log ? formatearGuia(g.contenido) : esc(extracto(g.contenido, 110))}</div>
                    ${log ? '' : `<div class="candado">${ic('lock')} Inicia sesión para leer la guía completa <button class="btn btn-primario btn-sm" data-accion="abrir-login">Ingresar</button></div>`}
                </div>`).join('')}`;
    } catch (e) {
        $('producto-contenido').innerHTML = `<p class="vacio">${esc(e.message)}</p>`;
    }
}

// ======================= GUÍAS =======================
async function cargarGuias() {
    if (!guiasTodas) {
        $('grid-guias').innerHTML = '<p class="cargando">Cargando guías…</p>';
        try { guiasTodas = (await api('/products/guias/todas')).guias; }
        catch (e) { $('grid-guias').innerHTML = `<p class="vacio">${esc(e.message)}</p>`; return; }
    }
    renderGuias();
}

function renderGuias() {
    const q = $('g-buscar').value.trim().toLowerCase();
    const log = !!sesion.token;
    const lista = guiasTodas.filter(g => (filtroGuia === 'Todas' || g.tipo_guia === filtroGuia) && (!q || (g.titulo + ' ' + g.producto).toLowerCase().includes(q)));
    $('grid-guias').innerHTML = lista.length ? lista.map(g => `
        <button class="guia-card t-${esc(g.tipo_guia)}" data-accion="guia" data-id="${esc(g.id_guia)}">
            <div class="guia-ic">${ic(ICONO_GUIA[g.tipo_guia] || 'book')}</div>
            <h3>${esc(g.titulo)}</h3>
            <p>${esc(extracto(g.contenido, 120))}</p>
            <div class="pie-guia"><span>${esc(g.tipo_guia)}${g.nivel_dificultad ? ' · ' + esc(g.nivel_dificultad) : ''}</span><span>${log ? 'Leer guía ' + ic('arrow') : ic('lock') + ' Con tu cuenta'}</span></div>
        </button>`).join('') : '<p class="vacio">No hay guías con ese criterio.</p>';
}
$('g-buscar').addEventListener('input', renderGuias);

function abrirGuia(id) {
    const g = (guiasTodas || []).find(x => x.id_guia === id);
    if (!g) return;
    const log = !!sesion.token;
    $('guia-contenido').innerHTML = `
        <div class="guia-ic" style="width:52px;height:52px;border-radius:14px;background:var(--menta);color:var(--verde);display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:12px">${ic(ICONO_GUIA[g.tipo_guia] || 'book')}</div>
        <span class="eyebrow">${esc(g.tipo_guia)}${g.nivel_dificultad ? ' · ' + esc(g.nivel_dificultad) : ''}</span>
        <h2>${esc(g.titulo)}</h2>
        <p style="color:#667068">Para: <strong>${esc(g.producto)}</strong></p>
        <div class="guia-bloque ${log ? '' : 'bloqueada'}"><div class="guia-texto">${log ? formatearGuia(g.contenido) : esc(extracto(g.contenido, 110))}</div>
        ${log ? '' : `<div class="candado">${ic('lock')} Inicia sesión para leer la guía completa</div>`}</div>
        <div class="fila-botones" style="margin-top:18px">
            ${log ? '' : '<button class="btn btn-primario" data-accion="abrir-login">Ingresar</button>'}
            <button class="btn btn-fantasma" data-accion="detalle" data-id="${esc(g.id_producto)}">Ver producto</button>
        </div>`;
    abrirModal('modal-guia');
}

// ======================= CARRITO (RF-09) =======================
function guardarCarrito() {
    localStorage.setItem('bioflora_carrito', JSON.stringify(carrito));
    const n = carrito.reduce((s, i) => s + i.cantidad, 0);
    $('contador-carrito').textContent = n;
    $('contador-carrito').hidden = n === 0;
}

function agregarAlCarrito(p) {
    if (!p) return;
    if (!sesion.token) { // invitado: se pide ingresar y se recuerda el producto
        pendiente = p;
        abrirAuth('login', 'Inicia sesión para agregar productos a tu carrito');
        return;
    }
    const existente = carrito.find(i => i.id === p.id_producto);
    if ((existente ? existente.cantidad : 0) + 1 > p.stock) return mostrarAviso(`Solo hay ${p.stock} unidades de ${p.nombre}`, 'error');
    if (existente) { existente.cantidad += 1; existente.stock = p.stock; }
    else carrito.push({ id: p.id_producto, nombre: p.nombre, precio: Number(p.precio), cantidad: 1, stock: p.stock, emoji: emojiProducto(p) });
    guardarCarrito();
    mostrarAviso(`${p.nombre} agregado al carrito 🛒`);
}

function renderizarCarrito() {
    const vacio = carrito.length === 0;
    $('carrito-vacio').hidden = !vacio;
    $('carrito-pie').hidden = vacio;
    $('carrito-lista').innerHTML = carrito.map(i => `
        <div class="item-carrito">
            <div class="item-img">${i.emoji || '🌿'}</div>
            <div><strong>${esc(i.nombre)}</strong><small>${dinero(i.precio)} c/u</small>
                <div class="cantidad">
                    <button data-accion="carrito" data-op="menos" data-id="${esc(i.id)}" aria-label="Quitar una unidad">${ic('minus')}</button>
                    <span>${esc(i.cantidad)}</span>
                    <button data-accion="carrito" data-op="mas" data-id="${esc(i.id)}" aria-label="Agregar una unidad">${ic('plus')}</button>
                </div></div>
            <div style="text-align:right"><strong>${dinero(i.precio * i.cantidad)}</strong>
                <button class="quitar" data-accion="carrito" data-op="quitar" data-id="${esc(i.id)}" aria-label="Quitar del carrito">${ic('trash')}</button></div>
        </div>`).join('');
    $('carrito-total').textContent = dinero(carrito.reduce((s, i) => s + i.precio * i.cantidad, 0));
}

function abrirCarrito() {
    if (!sesion.token) { abrirAuth('login', 'Inicia sesión para usar tu carrito'); return; }
    renderizarCarrito();
    abrirModal('modal-carrito');
}
$('btn-carrito').addEventListener('click', abrirCarrito);
$('tipo-entrega').addEventListener('change', () => { $('campo-direccion').hidden = $('tipo-entrega').value !== 'Domicilio'; });

// ======================= CONFIRMAR PEDIDO (RF-10) =======================
$('btn-comprar').addEventListener('click', async () => {
    if (!sesion.token) return abrirAuth('login');
    if (carrito.length === 0) return mostrarAviso('Tu carrito está vacío', 'error');
    const tipo = $('tipo-entrega').value;
    const direccion = $('direccion-entrega').value.trim();
    if (tipo === 'Domicilio' && !direccion) return mostrarAviso('Escribe tu dirección para la entrega', 'error');

    $('btn-comprar').disabled = true;
    try {
        const datos = await api('/orders', {
            metodo: 'POST', auth: true,
            cuerpo: { tipo_entrega: tipo, direccion_entrega: tipo === 'Domicilio' ? direccion : null, items: carrito.map(i => ({ id_producto: i.id, cantidad: i.cantidad })) }
        });
        carrito = [];
        guardarCarrito();
        cerrarModal('modal-carrito');
        $('exito-numero').textContent = datos.id_pedido;
        abrirModal('modal-exito');
        if (rutaActual() === 'tienda') cargarCatalogo(); // el stock cambió
    } catch (e) {
        mostrarAviso(e.message, 'error');
    } finally {
        $('btn-comprar').disabled = false;
    }
});

// ======================= INGRESO Y REGISTRO (RF-01, RF-02) =======================
let modoRegistro = false;
function abrirAuth(modo = 'login', mensaje = '') {
    modoRegistro = modo === 'registro';
    $('auth-titulo').textContent = modoRegistro ? 'Crea tu cuenta' : 'Bienvenido de nuevo';
    $('auth-sub').textContent = mensaje || (modoRegistro ? 'Únete a la comunidad BIOFLORA y empieza a cultivar.' : 'Ingresa para comprar y ver tus pedidos.');
    $('tab-login').classList.toggle('activo', !modoRegistro);
    $('tab-registro').classList.toggle('activo', modoRegistro);
    $('campo-nombre').hidden = !modoRegistro;
    $('campo-telefono').hidden = !modoRegistro;
    $('campo-clave2').hidden = !modoRegistro;
    $('auth-clave').autocomplete = modoRegistro ? 'new-password' : 'current-password';
    $('btn-auth').textContent = modoRegistro ? 'Crear mi cuenta' : 'Ingresar';
    abrirModal('modal-auth');
    setTimeout(() => (modoRegistro ? $('auth-nombre') : $('auth-correo')).focus(), 60);
}

$('form-auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const correo = $('auth-correo').value.trim();
    const clave = $('auth-clave').value;
    if (!correo || !clave) return mostrarAviso('Llena el correo y la contraseña', 'error');

    $('btn-auth').disabled = true;
    try {
        if (modoRegistro) {
            const nombre = $('auth-nombre').value.trim();
            if (nombre.length < 2) throw new Error('Escribe tu nombre completo');
            if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
            if (clave !== $('auth-clave2').value) throw new Error('Las contraseñas no coinciden');
            await api('/auth/registro', { metodo: 'POST', cuerpo: { nombre, correo, contrasena: clave, telefono: $('auth-telefono').value.trim() } });
        }
        const datos = await api('/auth/login', { metodo: 'POST', cuerpo: { correo, contrasena: clave } });
        sesion.guardar(datos.token, datos.usuario);
        $('form-auth').reset();
        cerrarModal('modal-auth');
        actualizarSesionUI();
        mostrarVista();
        mostrarAviso(`¡Bienvenido, ${datos.usuario.nombre.split(' ')[0]}! 🌿`);
        if (pendiente) { const p = pendiente; pendiente = null; agregarAlCarrito(p); }
    } catch (err) {
        mostrarAviso(err.message, 'error');
    } finally {
        $('btn-auth').disabled = false;
    }
});

function cerrarSesion() {
    sesion.borrar();
    carrito = [];
    guardarCarrito();
    actualizarSesionUI();
    if (rutaActual() === 'pedidos') location.hash = '#/inicio'; else mostrarVista();
    mostrarAviso('Sesión cerrada. ¡Hasta pronto!');
}

// ======================= MIS PEDIDOS (RF-11) =======================
function tracker(estado) {
    if (estado === 'Cancelado') return '<div class="cancelado-banner">Este pedido fue cancelado.</div>';
    const actual = PASOS.indexOf(estado);
    return `<div class="tracker">${PASOS.map((s, k) => `<div class="t-paso ${k <= actual ? 'hecho' : ''}"><div class="punto">${k <= actual ? ic('check') : ''}</div>${s}</div>`).join('')}</div>`;
}

async function cargarPedidos() {
    $('lista-pedidos').innerHTML = '<p class="cargando">Cargando tus pedidos…</p>';
    try {
        const { pedidos } = await api('/orders', { auth: true });
        const validos = pedidos.filter(p => p.estado !== 'Cancelado');
        $('stats-pedidos').innerHTML = `
            <div class="stat-mini"><div class="ico">${ic('package')}</div><div><strong>${pedidos.length}</strong><span>Pedidos realizados</span></div></div>
            <div class="stat-mini"><div class="ico">${ic('leaf')}</div><div><strong>${validos.reduce((s, p) => s + Number(p.articulos), 0)}</strong><span>Artículos comprados</span></div></div>
            <div class="stat-mini"><div class="ico">${ic('dollar')}</div><div><strong>${dinero(validos.reduce((s, p) => s + Number(p.total), 0))}</strong><span>Total invertido</span></div></div>`;
        if (pedidos.length === 0) {
            $('lista-pedidos').innerHTML = '<div class="vacio"><div style="font-size:60px">🪴</div><h3>Aún no tienes pedidos</h3><p>Cuando hagas tu primera compra aparecerá aquí.</p><a class="btn btn-primario" href="#/tienda">Ir a la tienda</a></div>';
            return;
        }
        $('lista-pedidos').innerHTML = pedidos.map(p => `
            <div class="pedido-card">
                <div class="pedido-cab"><div><h3>Pedido #${esc(p.id_pedido)}</h3><small>${fechaCorta(p.fecha)} · ${esc(p.articulos)} artículo${Number(p.articulos) === 1 ? '' : 's'}</small></div>${chipEstado(p.estado)}</div>
                ${tracker(p.estado)}
                <div class="pedido-info">
                    <span>${ic('truck')} ${esc(p.tipo_entrega)}${p.direccion_entrega ? ' · ' + esc(p.direccion_entrega) : ''}</span>
                    <span class="pedido-total">${dinero(p.total)}</span>
                </div>
                <button class="btn btn-fantasma btn-sm" style="margin-top:14px" data-accion="detalle-pedido" data-id="${esc(p.id_pedido)}">Ver productos</button>
                <div id="detalle-pedido-${esc(p.id_pedido)}"></div>
            </div>`).join('');
    } catch (e) {
        $('lista-pedidos').innerHTML = `<p class="vacio">${esc(e.message)}</p>`;
    }
}

async function alternarDetallePedido(id) {
    const cont = $('detalle-pedido-' + id);
    if (cont.innerHTML) { cont.innerHTML = ''; return; }
    try {
        const { detalles } = await api('/orders/' + id, { auth: true });
        cont.innerHTML = `<div class="tabla-wrap" style="margin-top:12px"><table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${detalles.map(d =>
            `<tr><td>${esc(d.nombre)}</td><td>${esc(d.cantidad)}</td><td>${dinero(d.precio_unitario)}</td><td>${dinero(d.subtotal)}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) { mostrarAviso(e.message, 'error'); }
}

// ======================= CLICS (delegación de eventos) =======================
document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-usuario')) $('menu-usuario').hidden = true;
    const el = e.target.closest('[data-accion]');
    if (!el) return;
    const id = Number(el.dataset.id);

    switch (el.dataset.accion) {
        case 'agregar': agregarAlCarrito(mapaProductos.get(id)); break;
        case 'detalle': cerrarModal('modal-guia'); verDetalle(id); break;
        case 'guia': abrirGuia(id); break;
        case 'abrir-login': e.preventDefault(); abrirAuth('login'); break;
        case 'abrir-registro': e.preventDefault(); abrirAuth('registro'); break;
        case 'cerrar-sesion': cerrarSesion(); break;
        case 'ver-clave': { const c = $(el.dataset.campo); c.type = c.type === 'password' ? 'text' : 'password'; break; }
        case 'ir-categoria':
            Object.keys(filtros).forEach(k => { filtros[k] = ''; });
            filtros.categoria = String(id);
            if (rutaActual() === 'tienda') cargarCatalogo(); else location.hash = '#/tienda';
            break;
        case 'pill': filtros.categoria = el.dataset.valor; cargarCatalogo(); break;
        case 'quitar-filtro': filtros[el.dataset.filtro] = ''; cargarCatalogo(); break;
        case 'limpiar-filtros': Object.keys(filtros).forEach(k => { filtros[k] = ''; }); cargarCatalogo(); break;
        case 'filtros-movil': $('filtros-panel').classList.toggle('abierto'); break;
        case 'tab-guia':
            filtroGuia = el.dataset.tipo;
            document.querySelectorAll('#tabs-guias .pill').forEach(b => b.classList.toggle('activo', b === el));
            renderGuias();
            break;
        case 'carrito': {
            const item = carrito.find(i => i.id === id);
            if (!item) break;
            if (el.dataset.op === 'mas') { if (item.cantidad + 1 > item.stock) { mostrarAviso(`Solo hay ${item.stock} unidades`, 'error'); break; } item.cantidad += 1; }
            if (el.dataset.op === 'menos') item.cantidad -= 1;
            if (el.dataset.op === 'quitar' || item.cantidad <= 0) carrito = carrito.filter(i => i !== item);
            guardarCarrito();
            renderizarCarrito();
            break;
        }
        case 'detalle-pedido': alternarDetallePedido(id); break;
    }
});

// ======================= INICIO DE LA APP =======================
$('anio').textContent = new Date().getFullYear();
actualizarSesionUI();
guardarCarrito();
hidratarIconos();
mostrarVista();