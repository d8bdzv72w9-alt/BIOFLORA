// ===== BIOFLORA · utilidades compartidas (tienda + panel admin) =====

// Si la página se abre desde http://localhost:3000 usa rutas relativas
const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000/api' : '/api';

// Escapa texto antes de ponerlo en innerHTML (evita XSS)
function esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const dinero = (n) => '$' + Number(n || 0).toFixed(2);
const fechaCorta = (f) => new Date(f).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
const extracto = (t, n = 130) => { t = String(t || ''); return t.length > n ? t.slice(0, n).trim() + '…' : t; };

// Sesión guardada en el navegador
const sesion = {
    get token() { return localStorage.getItem('bioflora_token'); },
    get nombre() { return localStorage.getItem('bioflora_usuario') || ''; },
    get rol() { return localStorage.getItem('bioflora_rol'); },
    get inicial() { return (this.nombre || '?').trim().charAt(0).toUpperCase(); },
    guardar(token, usuario) {
        localStorage.setItem('bioflora_token', token);
        localStorage.setItem('bioflora_usuario', usuario.nombre);
        localStorage.setItem('bioflora_rol', usuario.rol);
    },
    borrar() { ['bioflora_token', 'bioflora_usuario', 'bioflora_rol'].forEach(k => localStorage.removeItem(k)); }
};

// Llamada a la API: lanza Error con el mensaje del servidor si algo falla
async function api(ruta, { metodo = 'GET', cuerpo = null, auth = false } = {}) {
    const headers = {};
    if (cuerpo) headers['Content-Type'] = 'application/json';
    if (auth && sesion.token) headers['Authorization'] = `Bearer ${sesion.token}`;

    let respuesta;
    try {
        respuesta = await fetch(API + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : null });
    } catch (e) {
        throw new Error('No se pudo conectar con el servidor.');
    }
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
        if (respuesta.status === 401 && auth) { // sesión vencida o cuenta desactivada
            sesion.borrar();
            mostrarAviso(datos.error || 'Tu sesión terminó. Inicia sesión de nuevo.', 'error');
            setTimeout(() => location.reload(), 1500);
        }
        throw new Error(datos.error || 'Ocurrió un error inesperado.');
    }
    return datos;
}

// ---------- Aviso flotante ----------
let temporizadorAviso;
function mostrarAviso(mensaje, tipo = 'ok') {
    let el = document.getElementById('aviso');
    if (!el) { el = document.createElement('div'); el.id = 'aviso'; document.body.appendChild(el); }
    el.textContent = mensaje;
    el.className = 'visible ' + (tipo === 'error' ? 'error' : '');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => el.classList.remove('visible'), 3200);
}

// ---------- Modales ----------
function sincronizarScroll() {
    document.body.classList.toggle('sin-scroll', !!document.querySelector('.modal.abierto, .nav.abierto, .adm-menu.abierto'));
}
function abrirModal(id) { document.getElementById(id).classList.add('abierto'); sincronizarScroll(); }
function cerrarModal(id) { document.getElementById(id).classList.remove('abierto'); sincronizarScroll(); }
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal') && !e.target.dataset.confirm) { e.target.classList.remove('abierto'); sincronizarScroll(); }
    const cierre = e.target.closest('[data-cerrar]');
    if (cierre) cerrarModal(cierre.dataset.cerrar);
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { document.querySelectorAll('.modal.abierto:not([data-confirm])').forEach(m => m.classList.remove('abierto')); sincronizarScroll(); }
});

// Confirmación con ventana propia (reemplaza a confirm()). Uso: if (await confirmar('...')) { ... }
function confirmar(mensaje, { titulo = '¿Estás seguro?', si = 'Confirmar', peligro = false } = {}) {
    return new Promise((resolver) => {
        const m = document.createElement('div');
        m.className = 'modal abierto';
        m.dataset.confirm = '1';
        m.style.zIndex = 2500;
        m.innerHTML = `<div class="modal-caja pequena"><h2>${esc(titulo)}</h2><p style="color:#667068">${esc(mensaje)}</p>
            <div class="fila-botones" style="justify-content:center">
            <button class="btn btn-fantasma" data-r="0">Cancelar</button>
            <button class="btn ${peligro ? 'btn-rosa' : 'btn-primario'}" data-r="1">${esc(si)}</button></div></div>`;
        document.body.appendChild(m);
        sincronizarScroll();
        const fin = (v) => { m.remove(); sincronizarScroll(); resolver(v); };
        m.addEventListener('click', (e) => {
            const b = e.target.closest('[data-r]');
            if (b) fin(b.dataset.r === '1'); else if (e.target === m) fin(false);
        });
    });
}

// ---------- Iconos (SVG en línea, estilo línea) ----------
const ICONOS = {
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    recycle: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>'
};
function ic(nombre, extra = '') {
    return `<svg class="ic ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;
}
// Convierte <i data-ic="cart"></i> en un icono SVG
function hidratarIconos(raiz = document) {
    raiz.querySelectorAll('[data-ic]:not([data-hecho])').forEach(el => { el.innerHTML = ic(el.dataset.ic); el.dataset.hecho = '1'; });
}
hidratarIconos();

// ---------- Visual de cada producto (emoji, mientras no haya imágenes) ----------
const EMOJI_CATEGORIA = { 1: '🌿', 2: '🏺', 3: '🧺', 4: '🌱' };
function emojiProducto(p) {
    const n = String(p.nombre || '').toLowerCase();
    if (n.includes('cactus')) return '🌵';
    if (n.includes('suculenta') || n.includes('sábila') || n.includes('sabila')) return '🪴';
    if (n.includes('albahaca') || n.includes('menta') || n.includes('lechuga') || n.includes('semilla')) return '🌱';
    if (n.includes('helecho') || n.includes('pothos')) return '🌿';
    if (n.includes('maceta')) return '🏺';
    if (n.includes('kit')) return '🧺';
    if (n.includes('tierra')) return '🌾';
    return EMOJI_CATEGORIA[p.id_categoria] || '🌿';
}

// Etiqueta de color para el estado de un pedido
function chipEstado(estado) {
    const clase = { 'Pendiente': 'chip-Pendiente', 'En preparación': 'chip-Prep', 'Entregado': 'chip-Entregado', 'Cancelado': 'chip-Cancelado' }[estado] || '';
    return `<span class="chip ${clase}">${esc(estado)}</span>`;
}
