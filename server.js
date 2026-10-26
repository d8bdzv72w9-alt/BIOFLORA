const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ── Configuración mínima obligatoria ──
if (!process.env.JWT_SECRET) {
    console.error('❌ Falta JWT_SECRET en el archivo .env (usa .env.example como guía).');
    process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
    console.warn('⚠️  JWT_SECRET es corto. Usa uno aleatorio de 32+ caracteres antes de entregar o publicar el proyecto.');
}

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS: solo orígenes conocidos (el propio servidor y, opcionalmente, Live Server) ──
const origenesPermitidos = (process.env.CORS_ORIGIN || `http://localhost:${PORT},http://127.0.0.1:5500,http://localhost:5500`)
    .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({ origin: (origen, cb) => cb(null, !origen || origenesPermitidos.includes(origen)) }));

app.use(express.json({ limit: '100kb' }));

// Cabeceras de seguridad básicas
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});

// ── API ──
app.get('/api/salud', (req, res) => res.json({ mensaje: '¡El servidor de BIOFLORA está vivo!' }));
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ── Frontend: el mismo servidor entrega la tienda (http://localhost:3000) ──
const carpetaFrontend = process.env.FRONTEND_DIR || __dirname;
if (fs.existsSync(carpetaFrontend)) {
    app.use(express.static(carpetaFrontend));
}

// ── Manejo de errores (JSON mal formado, fallos inesperados) ──
app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido' });
    }
    if (error.type === 'entity.too.large') {
        return res.status(413).json({ error: 'La petición es demasiado grande' });
    }
    console.error(error);
    res.status(500).json({ error: 'Error interno del servidor' });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 BIOFLORA en http://localhost:${PORT}`);
    });
}

module.exports = app;
