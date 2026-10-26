const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { verificarToken } = require('../middleware/auth');
const { REGEX_CORREO, textoLimpio, responderError } = require('../utils/validar');

// Máximo 10 intentos FALLIDOS cada 15 minutos por IP (frena la fuerza bruta de contraseñas).
// Los intentos exitosos no cuentan, así registrarse o entrar varias veces no bloquea a nadie.
const limitadorAcceso = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
});

// 1. REGISTRO DE USUARIOS (RF-01)
router.post('/registro', limitadorAcceso, async (req, res) => {
    const nombre = textoLimpio(req.body.nombre);
    const correo = textoLimpio(req.body.correo).toLowerCase();
    const contrasena = typeof req.body.contrasena === 'string' ? req.body.contrasena : '';
    const telefono = textoLimpio(req.body.telefono);

    if (!nombre || !correo || !contrasena) {
        return res.status(400).json({ error: 'Nombre, correo y contraseña son obligatorios' });
    }
    if (nombre.length > 80) return res.status(400).json({ error: 'El nombre no puede superar 80 caracteres' });
    if (correo.length > 100 || !REGEX_CORREO.test(correo)) {
        return res.status(400).json({ error: 'El correo no tiene un formato válido' });
    }
    // bcrypt solo usa los primeros 72 bytes, por eso ese es el máximo
    if (contrasena.length < 8 || Buffer.byteLength(contrasena) > 72) {
        return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres' });
    }
    if (telefono.length > 15) return res.status(400).json({ error: 'El teléfono no puede superar 15 caracteres' });

    try {
        const contrasenaSegura = await bcrypt.hash(contrasena, 10);
        const [resultado] = await db.query(
            'CALL pa_registrar_usuario(?, ?, ?, ?)',
            [nombre, correo, contrasenaSegura, telefono || null]
        );
        res.status(201).json({ mensaje: '¡Usuario registrado con éxito!', id: resultado[0][0].id_usuario });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Ese correo ya está registrado' });
        }
        responderError(res, error, 'Error en el servidor al registrar');
    }
});

// 2. INICIO DE SESIÓN (RF-02)
router.post('/login', limitadorAcceso, async (req, res) => {
    const correo = textoLimpio(req.body.correo).toLowerCase();
    const contrasena = typeof req.body.contrasena === 'string' ? req.body.contrasena : '';

    if (!correo || !contrasena) {
        return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
    }

    try {
        const [resultado] = await db.query('CALL pa_login_usuario(?)', [correo]);
        const usuario = resultado[0][0];

        // Mismo mensaje para "no existe", "inactivo" y "clave incorrecta": no revelamos qué correos existen
        const mensajeGenerico = 'Credenciales incorrectas o cuenta inactiva';
        if (!usuario || usuario.estado === 0) {
            return res.status(401).json({ error: mensajeGenerico });
        }
        const esCorrecta = await bcrypt.compare(contrasena, usuario.contrasena);
        if (!esCorrecta) {
            return res.status(401).json({ error: mensajeGenerico });
        }

        const token = jwt.sign(
            { id: usuario.id_usuario, rol: usuario.rol },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({
            mensaje: '¡Bienvenido a BIOFLORA!',
            token,
            usuario: { id: usuario.id_usuario, nombre: usuario.nombre, rol: usuario.rol }
        });
    } catch (error) {
        responderError(res, error, 'Error en el servidor al iniciar sesión');
    }
});

// 3. QUIÉN SOY (sirve para que el frontend valide su sesión al cargar la página)
router.get('/me', verificarToken, (req, res) => {
    res.json({ usuario: req.usuario });
});

module.exports = router;
