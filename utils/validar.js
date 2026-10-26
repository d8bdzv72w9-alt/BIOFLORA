// Utilidades de validación y manejo de errores compartidas por todas las rutas.

const ENUMS = {
    nivel_luz: ['Baja', 'Media', 'Alta'],
    tamano: ['Pequeño', 'Mediano', 'Grande'],
    uso: ['Aula', 'Huerto escolar', 'Hogar'],
    tipo_guia: ['Cuidado', 'Siembra', 'Reciclaje'],
    nivel_dificultad: ['Fácil', 'Medio', 'Difícil'],
    estado_pedido: ['Pendiente', 'En preparación', 'Entregado', 'Cancelado'],
    tipo_entrega: ['Retiro en la institución', 'Domicilio']
};

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Devuelve un entero positivo o null
function entero(valor) {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function textoLimpio(valor) {
    return typeof valor === 'string' ? valor.trim() : '';
}

function fechaValida(texto) {
    if (typeof texto !== 'string' || !REGEX_FECHA.test(texto)) return false;
    const d = new Date(texto + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

// Revisa un campo enum opcional. Devuelve un mensaje de error o null.
function errorEnum(campo, valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    return ENUMS[campo].includes(valor) ? null : `${campo} inválido. Valores permitidos: ${ENUMS[campo].join(', ')}`;
}

// Traduce errores de MySQL a respuestas HTTP entendibles (en vez de un 500 genérico).
function responderError(res, error, mensajeGenerico) {
    console.error(error);

    // Errores lanzados por nuestros procedimientos/triggers (signal sqlstate '45000')
    if (error && error.sqlState === '45000') {
        return res.status(400).json({ error: error.sqlMessage });
    }
    switch (error && error.code) {
        case 'ER_DUP_ENTRY':
            return res.status(400).json({ error: 'Ya existe un registro con esos datos (valor duplicado).' });
        case 'ER_NO_REFERENCED_ROW_2':
            return res.status(400).json({ error: 'Hace referencia a un registro que no existe (categoría o producto inválido).' });
        case 'ER_ROW_IS_REFERENCED_2':
            return res.status(400).json({ error: 'No se puede eliminar: tiene registros asociados.' });
        case 'ER_CHECK_CONSTRAINT_VIOLATED':
            return res.status(400).json({ error: 'Alguno de los valores está fuera del rango permitido (precio, stock o cantidad).' });
        case 'ER_DATA_TOO_LONG':
            return res.status(400).json({ error: 'Alguno de los textos es demasiado largo.' });
    }
    return res.status(500).json({ error: mensajeGenerico });
}

module.exports = { ENUMS, REGEX_CORREO, entero, textoLimpio, fechaValida, errorEnum, responderError };
