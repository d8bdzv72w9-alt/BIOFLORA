const jwt = require('jsonwebtoken');

const verificarAdmin = (req, res, next) => {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acceso denegado. Debes iniciar sesión.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const usuarioVerificado = jwt.verify(token, process.env.JWT_SECRET);
        
        // ¡AQUÍ ESTÁ LA MAGIA! Revisamos si el rol es Administrador
        if (usuarioVerificado.rol !== 'Administrador') {
            return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
        }

        req.usuario = usuarioVerificado;
        next(); 
    } catch (error) {
        return res.status(401).json({ error: 'Sesión expirada o token inválido.' });
    }
};

module.exports = verificarAdmin;