const jwt = require('jsonwebtoken');

// Este es el "guardia" que revisa el Token antes de dejar pasar a alguien
const verificarToken = (req, res, next) => {
    // Busca el Token en los "headers" (la pulsera) de la petición
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acceso denegado. Debes iniciar sesión.' });
    }

    // Quita la palabra "Bearer " para quedarse solo con el texto largo
    const token = authHeader.split(' ')[1];

    try {
        // El guardia comprueba si la firma del Token es válida y no ha expirado
        const usuarioVerificado = jwt.verify(token, process.env.JWT_SECRET);
        
        // Si es válido, le dice al servidor: "Todo bien, este es el ID del usuario"
        req.usuario = usuarioVerificado; 
        next(); // Lo deja pasar a la cocina
    } catch (error) {
        return res.status(401).json({ error: 'Tu sesión ha expirado o el Token es inválido.' });
    }
};

module.exports = verificarToken;