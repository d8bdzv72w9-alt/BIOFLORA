const express = require('express');
const router = express.Router();
const db = require('../db');
const { verificarToken } = require('../middleware/auth');
const { ENUMS, entero, textoLimpio, responderError } = require('../utils/validar');

const MAX_ITEMS = 50;
const MAX_CANTIDAD = 1000;

// RF-09 y RF-10: crear un pedido (requiere sesión)
router.post('/', verificarToken, async (req, res) => {
    const idUsuario = req.usuario.id;
    const tipo_entrega = req.body.tipo_entrega;
    const direccion = textoLimpio(req.body.direccion_entrega);
    const items = req.body.items;

    if (!ENUMS.tipo_entrega.includes(tipo_entrega)) {
        return res.status(400).json({ error: 'Tipo de entrega inválido' });
    }
    if (tipo_entrega === 'Domicilio' && !direccion) {
        return res.status(400).json({ error: 'La dirección es obligatoria para entrega a domicilio' });
    }
    if (direccion.length > 200) return res.status(400).json({ error: 'La dirección no puede superar 200 caracteres' });
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío' });
    }
    if (items.length > MAX_ITEMS) return res.status(400).json({ error: `Máximo ${MAX_ITEMS} productos por pedido` });

    // Validamos cada línea y juntamos las repetidas (un mismo producto dos veces rompería la BD)
    const agrupados = new Map();
    for (const item of items) {
        const idProducto = entero(item && item.id_producto);
        const cantidad = entero(item && item.cantidad);
        if (!idProducto || !cantidad || cantidad > MAX_CANTIDAD) {
            return res.status(400).json({ error: 'Cada producto necesita id_producto y una cantidad entera positiva' });
        }
        agrupados.set(idProducto, (agrupados.get(idProducto) || 0) + cantidad);
    }
    const itemsLimpios = [...agrupados].map(([id_producto, cantidad]) => ({ id_producto, cantidad }));

    try {
        const [resultado] = await db.query('CALL pa_crear_pedido_completo(?, ?, ?, ?)', [
            idUsuario,
            tipo_entrega,
            tipo_entrega === 'Domicilio' ? direccion : null,
            JSON.stringify(itemsLimpios)
        ]);
        res.status(201).json({ mensaje: '¡Pedido realizado con éxito!', id_pedido: resultado[0][0].id_pedido });
    } catch (error) {
        responderError(res, error, 'Error interno al procesar el pedido');
    }
});

// RF-11: mis pedidos
router.get('/', verificarToken, async (req, res) => {
    try {
        const [filas] = await db.query('CALL pa_mis_pedidos(?)', [req.usuario.id]);
        res.json({ mensaje: 'Historial de pedidos obtenido', pedidos: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar el historial');
    }
});

// RF-11: detalle de UN pedido mío (el procedimiento filtra por usuario: nadie ve pedidos ajenos)
router.get('/:id', verificarToken, async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Id de pedido inválido' });

    try {
        const [filas] = await db.query('CALL pa_detalle_pedido(?, ?)', [id, req.usuario.id]);
        if (filas[0].length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado o no tienes permiso para verlo.' });
        }
        res.json({ mensaje: 'Detalle del pedido obtenido', detalles: filas[0] });
    } catch (error) {
        responderError(res, error, 'Error al cargar el detalle del pedido');
    }
});

module.exports = router;
