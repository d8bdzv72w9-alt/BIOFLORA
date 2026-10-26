const express = require('express');
const router = express.Router();
const db = require('../db');
const { ENUMS, entero, errorEnum, responderError } = require('../utils/validar');

// RF-06 (Catálogo) y RF-07 (Búsqueda y filtros)
router.get('/', async (req, res) => {
    const { texto, luz, tamano, uso, categoria, riego } = req.query;

    const problema =
        errorEnum('nivel_luz', luz) || errorEnum('tamano', tamano) || errorEnum('uso', uso);
    if (problema) return res.status(400).json({ error: problema });
    if (categoria && !entero(categoria)) return res.status(400).json({ error: 'categoria inválida' });
    if ((texto && String(texto).length > 100) || (riego && String(riego).length > 40)) {
        return res.status(400).json({ error: 'Texto de búsqueda demasiado largo' });
    }

    try {
        const [filas] = await db.query('CALL pa_filtrar_productos(?, ?, ?, ?, ?, ?)', [
            texto ? String(texto).trim() : null,
            luz || null,
            tamano || null,
            uso || null,
            categoria ? entero(categoria) : null,
            riego || null
        ]);
        res.json({ mensaje: 'Catálogo obtenido con éxito', total: filas[0].length, productos: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar el catálogo');
    }
});

// Categorías con descripción y cantidad de productos (tienda y panel de administración)
router.get('/categorias', async (req, res) => {
    try {
        const [filas] = await db.query('CALL pa_listar_categorias()');
        res.json({ categorias: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar las categorías');
    }
});

// Todas las guías de productos activos (página "Guías de cuidado")
router.get('/guias/todas', async (req, res) => {
    try {
        const [filas] = await db.query('CALL pa_listar_guias_publicas()');
        res.json({ guias: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar las guías');
    }
});

// Categorías y valores de filtro, para construir el panel de filtros del frontend
router.get('/filtros', async (req, res) => {
    try {
        const [filas] = await db.query('CALL pa_listar_categorias()');
        res.json({
            categorias: filas[0].map(c => ({ id_categoria: c.id_categoria, nombre: c.nombre })),
            nivel_luz: ENUMS.nivel_luz,
            tamano: ENUMS.tamano,
            uso: ENUMS.uso
        });
    } catch (error) {
        responderError(res, error, 'Error al cargar los filtros');
    }
});

// RF-08: detalle de UN producto y sus guías
router.get('/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de producto inválido' });

    try {
        const [prodRows] = await db.query('CALL pa_detalle_producto(?)', [id]);
        const producto = prodRows[0][0];
        // Un producto desactivado no se muestra al público
        if (!producto || producto.estado === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        const [guiasRows] = await db.query('CALL pa_listar_guias(?, ?)', [null, id]);
        res.json({ mensaje: 'Detalle del producto obtenido', producto, guias: guiasRows[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar el detalle del producto');
    }
});

module.exports = router;
