const jwt = require('jsonwebtoken');
const db = require('../db');

// Guardia 1: exige un token válido Y comprueba en la BD que el usuario siga activo.
// Así, si el administrador desactiva a alguien, deja de tener acceso de inmediato
// y no hasta que expire su token. El rol también se lee de la BD, no del token.
async function verificarToken(req, res, next) {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acceso denegado. Debes iniciar sesión.' });
    }
    const token = authHeader.split(' ')[1];

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({ error: 'Tu sesión ha expirado o el token es inválido.' });
    }

    try {
        const [filas] = await db.query('CALL pa_obtener_usuario(?)', [payload.id]);
        const usuario = filas[0][0];
        if (!usuario || usuario.estado === 0) {
            return res.status(401).json({ error: 'Tu cuenta no está disponible.' });
        }
        req.usuario = { id: usuario.id_usuario, nombre: usuario.nombre, rol: usuario.rol };
        next();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al validar la sesión.' });
    }
}

// Guardia 2: además de estar logueado, debe ser Administrador.
function soloAdmin(req, res, next) {
    if (!req.usuario || req.usuario.rol !== 'Administrador') {
        return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    }
    next();
}

module.exports = { verificarToken, soloAdmin };
