const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const PORT = process.env.PORT || 3000;
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const RENDER_SECRET_PATH = '/etc/secrets/serviceAccountKey.json';
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// Limpieza periodica de imagenes temporales (mas de 24 horas)
setInterval(() => {
  try {
    const now = Date.now();
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const file of files) {
      const filePath = path.join(UPLOADS_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.error('[ERROR] Error limpiando uploads antiguos:', err.message);
  }
}, 60 * 60 * 1000);

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
      error: 'Firebase Admin no esta inicializado. Configura FIREBASE_SERVICE_ACCOUNT en el servidor.',
    });
  }

  const {
    title = '¡Alerta Recibida!',
    body = 'Una persona ha presionado el boton en la app.',
    imageBase64,
  } = req.body;

  let imageUrl = req.body.imageUrl || null;

  // Si se envia una imagen en base64, guardarla en el servidor y generar URL publica
  if (imageBase64) {
    try {
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');

      let ext = 'jpg';
      if (buffer.length > 4) {
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
          ext = 'png';
        } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
          ext = 'webp';
        }
      }

      const filename = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const host = req.get('host');
      const rawProto = req.headers['x-forwarded-proto'];
      const proto = rawProto ? rawProto.split(',')[0].trim() : req.protocol;
      const protocol = host.includes('localhost') ? (proto || 'http') : 'https';
      imageUrl = `${protocol}://${host}/uploads/${filename}`;
      console.log('[OK] Imagen multimedia procesada y lista:', imageUrl);
    } catch (imgError) {
      console.error('[ERROR] Error procesando imagen base64:', imgError.message);
    }
  }

  // Estructura del mensaje FCM para que Android muestre la imagen expandible
  const notificationPayload = {
    title: String(title),
    body: String(body),
  };
  if (imageUrl) {
    notificationPayload.imageUrl = imageUrl;
  }

  const androidNotificationPayload = {
    sound: 'default',
    channelId: 'alerta_channel',
    priority: 'max',
  };
  if (imageUrl) {
    androidNotificationPayload.imageUrl = imageUrl;
  }

  const dataPayload = {
    title: String(title),
    body: String(body),
  };
  if (imageUrl) {
    dataPayload.imageUrl = String(imageUrl);
    dataPayload.image = String(imageUrl);
  }

  const message = {
    notification: notificationPayload,
    android: {
      priority: 'high',
      notification: androidNotificationPayload,
    },
    data: dataPayload,
    topic: 'alerta_general',
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(`[${new Date().toLocaleTimeString()}] Notificacion enviada exitosamente:`, response);
    return res.status(200).json({
      success: true,
      messageId: response,
      imageUrl: imageUrl,
      message: 'Notificacion enviada a todos los dispositivos suscritos.',
    });
  } catch (error) {
    console.error('[ERROR] Error al enviar mensaje via FCM:', error);
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

