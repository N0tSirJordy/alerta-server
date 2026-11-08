const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const RENDER_SECRET_PATH = '/etc/secrets/serviceAccountKey.json';

// Inicializar Firebase Admin SDK
let firebaseInitialized = false;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log('[OK] Firebase Admin SDK inicializado desde variable de entorno.');
  } catch (error) {
    console.error('[ERROR] Error al parsear FIREBASE_SERVICE_ACCOUNT:', error.message);
  }
} else if (fs.existsSync(RENDER_SECRET_PATH)) {
  try {
    const serviceAccount = require(RENDER_SECRET_PATH);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log('[OK] Firebase Admin SDK inicializado desde Render Secret File.');
  } catch (error) {
    console.error('[ERROR] Error al cargar secret de Render:', error.message);
  }
} else if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  try {
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log('[OK] Firebase Admin SDK inicializado correctamente desde archivo local.');
  } catch (error) {
    console.error('[ERROR] Error al cargar serviceAccountKey.json:', error.message);
  }
} else {
  console.warn('[AVISO] ATENCIÓN: No se encontró la configuración de Firebase.');
  console.warn('   Configura la variable de entorno FIREBASE_SERVICE_ACCOUNT o coloca serviceAccountKey.json.');
}

// Ruta de prueba / Estado del servidor
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    firebaseReady: firebaseInitialized,
    message: 'Servidor de alertas para la app Android',
  });
});

// Endpoint para enviar la alerta a todos los dispositivos
app.post('/api/send-alert', async (req, res) => {
  if (!firebaseInitialized) {
    return res.status(500).json({
      success: false,
      error: 'Firebase Admin no está inicializado. Coloca serviceAccountKey.json en la carpeta del servidor.',
    });
  }

  const { title = '¡Alerta Recibida!', body = 'Una persona ha presionado el botón en la app.' } = req.body;

  // Mensaje que se envía al tema 'alerta_general'
  const message = {
    notification: {
      title: title,
      body: body,
    },
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'alerta_channel',
        priority: 'max',
      },
    },
    topic: 'alerta_general',
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(`[${new Date().toLocaleTimeString()}] Notificación enviada exitosamente:`, response);
    return res.status(200).json({
      success: true,
      messageId: response,
      message: 'Notificación enviada a todos los dispositivos suscritos.',
    });
  } catch (error) {
    console.error('Error al enviar mensaje vía FCM:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`Esperando peticiones en POST http://localhost:${PORT}/api/send-alert`);
});

