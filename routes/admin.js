const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken, soloAdmin } = require('../middleware/auth');
const { ENUMS, entero, textoLimpio, fechaValida, errorEnum, responderError } = require('../utils/validar');

// Todas las rutas de este archivo exigen sesión + rol Administrador
router.use(verificarToken, soloAdmin);

// ───────────────────────── DASHBOARD Y REPORTES (RF-14) ─────────────────────────

router.get('/dashboard', async (req, res) => {
    try {
        const [filas] = await db.query('CALL pa_dashboard()');
        res.json({ mensaje: 'Datos del dashboard obtenidos', datos: filas[0][0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar el dashboard');
    }
});

function fechaLocal(d) {
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
}

// Todos los reportes en una sola llamada (gráficos del Panel y de la pestaña Reportes)
router.get('/reportes', async (req, res) => {
    try {
        const [[porMes], [porEstado], [masVendidos]] = await Promise.all([
            db.query('SELECT periodo, total_pedidos, ventas FROM v_ventas_por_mes'),
            db.query('SELECT estado, cantidad, monto FROM v_pedidos_por_estado'),
            db.query('SELECT id_producto, nombre, unidades_vendidas, ingresos FROM v_productos_mas_vendidos LIMIT 6')
        ]);
        res.json({ ventas_por_mes: porMes.slice(-12), pedidos_por_estado: porEstado, mas_vendidos: masVendidos });
    } catch (error) {
        responderError(res, error, 'Error al generar los reportes');
    }
});

// Ventas por periodo: resumen del rango ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (por defecto, el mes en curso)
// + serie mensual para el gráfico de barras.
router.get('/reportes/ventas', async (req, res) => {
    const hoy = new Date();
    const desde = req.query.desde || fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const hasta = req.query.hasta || fechaLocal(hoy);

    if (!fechaValida(desde) || !fechaValida(hasta)) {
        return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD' });
    }
    if (desde > hasta) return res.status(400).json({ error: '"desde" no puede ser posterior a "hasta"' });

    try {
        const [resumen] = await db.query('CALL pa_reporte_ventas(?, ?)', [desde, hasta]);
        const [porMes] = await db.query('SELECT periodo, total_pedidos, ventas FROM v_ventas_por_mes');
        const r = resumen[0][0];
        // total_pedidos y ventas van también al nivel principal (los usa el panel); "resumen" se conserva
        res.json({ desde, hasta, total_pedidos: r.total_pedidos, ventas: r.ventas, resumen: r, por_mes: porMes.slice(-12) });
    } catch (error) {
        responderError(res, error, 'Error al generar el reporte de ventas');
    }
});

router.get('/reportes/mas-vendidos', async (req, res) => {
    const limite = req.query.limite === undefined ? 5 : entero(req.query.limite);
    if (!limite || limite > 50) return res.status(400).json({ error: 'limite debe ser un entero entre 1 y 50' });
    try {
        const [filas] = await db.query(
            'SELECT id_producto, nombre, unidades_vendidas, ingresos FROM v_productos_mas_vendidos LIMIT ?',
            [limite]
        );
        res.json({ productos: filas });
    } catch (error) {
        responderError(res, error, 'Error al generar el reporte de productos más vendidos');
    }
});

router.get('/reportes/pedidos-por-estado', async (req, res) => {
    try {
        const [filas] = await db.query('SELECT estado, cantidad, monto FROM v_pedidos_por_estado');
        res.json({ estados: filas });
    } catch (error) {
        responderError(res, error, 'Error al generar el reporte de pedidos por estado');
    }
});

// ───────────────────────── PEDIDOS (RF-12) ─────────────────────────

router.get('/pedidos', async (req, res) => {
    const { estado } = req.query;
    const problema = errorEnum('estado_pedido', estado);
    if (problema) return res.status(400).json({ error: problema });
    const limite = req.query.limite === undefined ? null : entero(req.query.limite);
    if (req.query.limite !== undefined && !limite) return res.status(400).json({ error: 'limite inválido' });

    try {
        const [filas] = await db.query('CALL pa_listar_pedidos(?)', [estado || null]);
        res.json({ mensaje: 'Pedidos obtenidos', pedidos: limite ? filas[0].slice(0, limite) : filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar los pedidos');
    }
});

// Detalle (productos) de cualquier pedido
router.get('/pedidos/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de pedido inválido' });
    try {
        const [filas] = await db.query('CALL pa_detalle_pedido(?, ?)', [id, null]);
        if (filas[0].length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
        res.json({ detalles: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar el detalle del pedido');
    }
});

router.put('/pedidos/:id/estado', async (req, res) => {
    const id = entero(req.params.id);
    const { nuevo_estado } = req.body;
    if (!id) return res.status(400).json({ error: 'Id de pedido inválido' });
    if (!nuevo_estado) return res.status(400).json({ error: 'Debes enviar el nuevo_estado' });
    const problema = errorEnum('estado_pedido', nuevo_estado);
    if (problema) return res.status(400).json({ error: problema });

    try {
        // Las transiciones válidas las controla el procedimiento (no se reactiva un pedido cancelado, etc.)
        await db.query('CALL pa_cambiar_estado_pedido(?, ?)', [id, nuevo_estado]);
        res.json({ mensaje: 'Estado del pedido actualizado correctamente' });
    } catch (error) {
        responderError(res, error, 'Error al actualizar el pedido');
    }
});

// ───────────────────────── PRODUCTOS (RF-03) ─────────────────────────

const CAMPOS_PRODUCTO = ['nombre', 'descripcion', 'precio', 'stock', 'nivel_luz', 'frecuencia_riego', 'tamano', 'uso', 'imagen', 'estado', 'id_categoria'];

// Revisa un producto ya completo (después de mezclar). Devuelve mensaje de error o null.
function errorProducto(p) {
    if (!p.nombre || String(p.nombre).trim() === '') return 'El nombre es obligatorio';
    if (String(p.nombre).length > 100) return 'El nombre no puede superar 100 caracteres';
    const precio = Number(p.precio);
    if (p.precio === null || p.precio === undefined || p.precio === '' || !Number.isFinite(precio) || precio < 0 || precio > 999999.99) {
        return 'El precio debe ser un número entre 0 y 999999.99';
    }
    const stock = Number(p.stock);
    if (!Number.isInteger(stock) || stock < 0) return 'El stock debe ser un entero mayor o igual a 0';
    if (![0, 1].includes(Number(p.estado))) return 'estado debe ser 0 o 1';
    if (!entero(p.id_categoria)) return 'Debes indicar una categoría válida';
    if (p.frecuencia_riego && String(p.frecuencia_riego).length > 40) return 'frecuencia_riego no puede superar 40 caracteres';
    if (p.imagen && String(p.imagen).length > 255) return 'imagen no puede superar 255 caracteres';
    return errorEnum('nivel_luz', p.nivel_luz) || errorEnum('tamano', p.tamano) || errorEnum('uso', p.uso);
}

// '' -> null para los campos opcionales
const vacioANulo = v => (v === '' || v === undefined ? null : v);

// Lista TODOS los productos (activos e inactivos), con su categoría
router.get('/productos', async (req, res) => {
    try {
        const [filas] = await db.query('CALL pa_listar_productos_admin()');
        res.json({ total: filas[0].length, productos: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar los productos');
    }
});

router.get('/productos/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de producto inválido' });
    try {
        const [filas] = await db.query('CALL pa_detalle_producto(?)', [id]);
        if (!filas[0][0]) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json({ producto: filas[0][0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar el producto');
    }
});

router.post('/productos', async (req, res) => {
    const b = req.body;
    const producto = {
        nombre: textoLimpio(b.nombre),
        descripcion: vacioANulo(b.descripcion),
        precio: b.precio,
        stock: b.stock === undefined || b.stock === '' ? 0 : b.stock,
        nivel_luz: vacioANulo(b.nivel_luz),
        frecuencia_riego: vacioANulo(b.frecuencia_riego),
        tamano: vacioANulo(b.tamano),
        uso: vacioANulo(b.uso),
        imagen: vacioANulo(b.imagen),
        estado: 1,
        id_categoria: b.id_categoria === undefined ? 1 : b.id_categoria
    };
    const problema = errorProducto(producto);
    if (problema) return res.status(400).json({ error: problema });

    try {
        const [resultado] = await db.query('CALL pa_crear_producto(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            producto.nombre, producto.descripcion, Number(producto.precio), Number(producto.stock),
            producto.nivel_luz, producto.frecuencia_riego, producto.tamano, producto.uso,
            producto.imagen, entero(producto.id_categoria)
        ]);
        res.status(201).json({ mensaje: 'Producto creado con éxito', id_producto: resultado[0][0].id_producto });
    } catch (error) {
        responderError(res, error, 'Error al crear el producto');
    }
});

// Actualización PARCIAL: los campos que no vengan en el body conservan su valor actual.
// (Antes, editar un producto desde el formulario dejaba en NULL tamaño, riego e imagen.)
router.put('/productos/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de producto inválido' });

    try {
        const [actualRows] = await db.query('CALL pa_detalle_producto(?)', [id]);
        const actual = actualRows[0][0];
        if (!actual) return res.status(404).json({ error: 'Producto no encontrado' });

        const producto = {};
        for (const campo of CAMPOS_PRODUCTO) {
            producto[campo] = campo in req.body ? req.body[campo] : actual[campo];
        }
        producto.nombre = textoLimpio(producto.nombre);
        for (const campo of ['descripcion', 'nivel_luz', 'frecuencia_riego', 'tamano', 'uso', 'imagen']) {
            producto[campo] = vacioANulo(producto[campo]);
        }

        const problema = errorProducto(producto);
        if (problema) return res.status(400).json({ error: problema });

        await db.query('CALL pa_actualizar_producto(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            id, producto.nombre, producto.descripcion, Number(producto.precio), Number(producto.stock),
            producto.nivel_luz, producto.frecuencia_riego, producto.tamano, producto.uso,
            producto.imagen, Number(producto.estado), entero(producto.id_categoria)
        ]);
        res.json({ mensaje: 'Producto actualizado con éxito' });
    } catch (error) {
        responderError(res, error, 'Error al actualizar el producto');
    }
});

// Si el producto ya se vendió, el procedimiento lo desactiva; si no, lo borra.
router.delete('/productos/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de producto inválido' });
    try {
        const [resultado] = await db.query('CALL pa_eliminar_producto(?)', [id]);
        res.json({ mensaje: `Producto ${resultado[0][0].resultado} correctamente`, resultado: resultado[0][0].resultado });
    } catch (error) {
        responderError(res, error, 'Error al eliminar el producto');
    }
});

// ───────────────────────── CATEGORÍAS (RF-04) ─────────────────────────

function errorCategoria(nombre, descripcion) {
    if (!nombre) return 'El nombre de la categoría es obligatorio';
    if (nombre.length > 60) return 'El nombre no puede superar 60 caracteres';
    if (descripcion && descripcion.length > 150) return 'La descripción no puede superar 150 caracteres';
    return null;
}

router.get('/categorias', async (req, res) => {
    try {
        const [filas] = await db.query('CALL pa_listar_categorias()');
        res.json({ categorias: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar las categorías');
    }
});

router.post('/categorias', async (req, res) => {
    const nombre = textoLimpio(req.body.nombre);
    const descripcion = textoLimpio(req.body.descripcion) || null;
    const problema = errorCategoria(nombre, descripcion);
    if (problema) return res.status(400).json({ error: problema });
    try {
        const [r] = await db.query('CALL pa_crear_categoria(?, ?)', [nombre, descripcion]);
        res.status(201).json({ mensaje: 'Categoría creada con éxito', id_categoria: r[0][0].id_categoria });
    } catch (error) {
        responderError(res, error, 'Error al crear la categoría');
    }
});

router.put('/categorias/:id', async (req, res) => {
    const id = entero(req.params.id);
    const nombre = textoLimpio(req.body.nombre);
    const descripcion = textoLimpio(req.body.descripcion) || null;
    if (!id) return res.status(400).json({ error: 'Id de categoría inválido' });
    const problema = errorCategoria(nombre, descripcion);
    if (problema) return res.status(400).json({ error: problema });
    try {
        await db.query('CALL pa_actualizar_categoria(?, ?, ?)', [id, nombre, descripcion]);
        res.json({ mensaje: 'Categoría actualizada con éxito' });
    } catch (error) {
        responderError(res, error, 'Error al actualizar la categoría');
    }
});

router.delete('/categorias/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de categoría inválido' });
    try {
        await db.query('CALL pa_eliminar_categoria(?)', [id]); // falla con mensaje claro si tiene productos
        res.json({ mensaje: 'Categoría eliminada correctamente' });
    } catch (error) {
        responderError(res, error, 'Error al eliminar la categoría');
    }
});

// ───────────────────────── GUÍAS DE CUIDADO (RF-05) ─────────────────────────

function errorGuia(g) {
    if (!g.titulo || !g.contenido) return 'Título y contenido son obligatorios.';
    if (g.titulo.length > 120) return 'El título no puede superar 120 caracteres';
    return errorEnum('tipo_guia', g.tipo_guia) || errorEnum('nivel_dificultad', g.nivel_dificultad);
}

router.get('/guias', async (req, res) => {
    const { tipo } = req.query;
    const problema = errorEnum('tipo_guia', tipo);
    if (problema) return res.status(400).json({ error: problema });
    const producto = req.query.producto === undefined ? null : entero(req.query.producto);
    if (req.query.producto !== undefined && !producto) return res.status(400).json({ error: 'producto inválido' });
    try {
        const [filas] = await db.query('CALL pa_listar_guias(?, ?)', [tipo || null, producto]);
        res.json({ guias: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar las guías');
    }
});

router.post('/guias', async (req, res) => {
    const id_producto = entero(req.body.id_producto);
    const guia = {
        titulo: textoLimpio(req.body.titulo),
        contenido: textoLimpio(req.body.contenido),
        tipo_guia: req.body.tipo_guia || 'Cuidado',
        nivel_dificultad: req.body.nivel_dificultad || 'Fácil'
    };
    if (!id_producto) return res.status(400).json({ error: 'Producto, título y contenido son obligatorios.' });
    const problema = errorGuia(guia);
    if (problema) return res.status(400).json({ error: problema });
    try {
        const [r] = await db.query('CALL pa_crear_guia(?, ?, ?, ?, ?)',
            [id_producto, guia.titulo, guia.contenido, guia.tipo_guia, guia.nivel_dificultad]);
        res.status(201).json({ mensaje: 'Guía creada con éxito', id_guia: r[0][0].id_guia });
    } catch (error) {
        responderError(res, error, 'Error al crear la guía');
    }
});

router.put('/guias/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de guía inválido' });
    const guia = {
        titulo: textoLimpio(req.body.titulo),
        contenido: textoLimpio(req.body.contenido),
        tipo_guia: req.body.tipo_guia || 'Cuidado',
        nivel_dificultad: req.body.nivel_dificultad || 'Fácil'
    };
    const problema = errorGuia(guia);
    if (problema) return res.status(400).json({ error: problema });
    try {
        await db.query('CALL pa_actualizar_guia(?, ?, ?, ?, ?)',
            [id, guia.titulo, guia.contenido, guia.tipo_guia, guia.nivel_dificultad]);
        res.json({ mensaje: 'Guía actualizada con éxito' });
    } catch (error) {
        responderError(res, error, 'Error al actualizar la guía');
    }
});

router.delete('/guias/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de guía inválido' });
    try {
        await db.query('CALL pa_eliminar_guia(?)', [id]);
        res.json({ mensaje: 'Guía eliminada correctamente' });
    } catch (error) {
        responderError(res, error, 'Error al eliminar la guía');
    }
});

// ───────────────────────── USUARIOS (RF-13) ─────────────────────────

router.get('/usuarios', async (req, res) => {
    try {
        const [filas] = await db.query('CALL pa_listar_usuarios()');
        res.json({ usuarios: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar usuarios');
    }
});

router.put('/usuarios/:id/estado', async (req, res) => {
    const id = entero(req.params.id);
    const estado = Number(req.body.estado);
    if (!id) return res.status(400).json({ error: 'Id de usuario inválido' });
    if (![0, 1].includes(estado)) return res.status(400).json({ error: 'estado debe ser 1 (activo) o 0 (inactivo)' });
    if (id === req.usuario.id && estado === 0) {
        return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }
    try {
        // El procedimiento además impide desactivar a cualquier administrador
        await db.query('CALL pa_cambiar_estado_usuario(?, ?)', [id, estado]);
        res.json({ mensaje: 'Estado del usuario actualizado' });
    } catch (error) {
        responderError(res, error, 'Error al actualizar usuario');
    }
});

module.exports = router;
