// server.js (COMPLETO)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');

// ✅ Carica .env in locale (se presente). In produzione puoi usare env del provider.
try { require('dotenv').config(); } catch (e) {}

const app = express();

// ✅ IMPORTANTISSIMO se deploy dietro proxy (Render, Nginx, ecc.)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Static
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===============================
// ✅ MONGODB URI (ENV oppure DEFAULT)
// ===============================
// 👉 Incolla qui la tua URI (quella del "primo codice") se NON vuoi usare ENV.
// ⚠️ NON incollare password in chat: mettila qui nel tuo file locale o in ENV del provider.
const DEFAULT_MONGODB_URI = ''; // <-- INCOLLA QUI la tua URI mongodb+srv://...

const MONGODB_URI = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;

console.log('🔧 MongoDB URI source:', process.env.MONGODB_URI ? 'ENV (MONGODB_URI)' : 'DEFAULT_MONGODB_URI');
if (!MONGODB_URI) {
  console.warn('⚠️  Nessuna MONGODB_URI trovata. Imposta ENV MONGODB_URI o compila DEFAULT_MONGODB_URI.');
}

// ✅ Fail-fast: se DB è giù non bufferizza comandi all’infinito
mongoose.set('bufferCommands', false);

// ✅ Assicurati che uploads esista sempre
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Cartella uploads creata');
}

// ===============================
// ✅ Multer Upload
// ===============================
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (_req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const fileFilter = (_req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|heic|heif/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test((file.mimetype || '').toLowerCase());

  if (mimetype && extname) return cb(null, true);
  cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WEBP, HEIC, HEIF)'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5
  }
});

// ===============================
// ✅ Schema Spot
// ===============================
const spotSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  location: { type: String, required: true },
  status: {
    type: String,
    enum: ['planned', 'completed'],
    default: 'planned'
  },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  description: { type: String, required: true },
  planA: { type: String },
  alternativeSpots: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Spot' }],
  photos: [{ type: String }], // es: "/uploads/optimized-xxx.jpg"
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

spotSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const Spot = mongoose.model('Spot', spotSchema);

// ===============================
// ✅ Helpers: DB state + guard
// ===============================
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

function requireDb(_req, res, next) {
  if (!isDbConnected()) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'MongoDB non connesso. Controlla MONGODB_URI / whitelist IP su Atlas / credenziali.',
      databaseState: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState]
    });
  }
  next();
}

// ===============================
// ✅ Helpers: filesystem
// ===============================
function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error('safeUnlink error:', e.message);
  }
}

// ===============================
// ✅ Satellite “free/no key” URL (Esri Export)
// ===============================
function latLngToWebMercator(lat, lng) {
  const x = (lng * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return { x, y };
}

function buildEsriStaticImage(lat, lng, zoom = 19, width = 900, height = 500) {
  const { x, y } = latLngToWebMercator(lat, lng);
  const initialRes = 156543.03392804097; // m/px @ zoom 0
  const res = initialRes / Math.pow(2, zoom);

  const halfW = (width / 2) * res;
  const halfH = (height / 2) * res;

  const bbox = `${x - halfW},${y - halfH},${x + halfW},${y + halfH}`;

  return (
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
    `?bbox=${encodeURIComponent(bbox)}` +
    '&bboxSR=3857&imageSR=3857' +
    `&size=${width},${height}` +
    '&format=jpg&f=image'
  );
}

function attachSatellite(spotsOrSpot) {
  const add = (s) => {
    if (!s) return s;
    const obj = typeof s.toObject === 'function' ? s.toObject() : s;
    if (typeof obj.lat === 'number' && typeof obj.lng === 'number') {
      obj.satelliteImage = buildEsriStaticImage(obj.lat, obj.lng, 19, 900, 500);
      obj.satelliteImageLarge = buildEsriStaticImage(obj.lat, obj.lng, 19, 1200, 800);
    } else {
      obj.satelliteImage = null;
      obj.satelliteImageLarge = null;
    }
    return obj;
  };

  if (Array.isArray(spotsOrSpot)) return spotsOrSpot.map(add);
  return add(spotsOrSpot);
}

// ===============================
// ✅ HEIC/HEIF -> JPG
// ===============================
async function convertHeicToJpeg(filePath) {
  try {
    const lower = filePath.toLowerCase();
    if (!lower.endsWith('.heic') && !lower.endsWith('.heif')) return filePath;

    const jpegPath = filePath.replace(/\.[^/.]+$/, '.jpg');

    await sharp(filePath)
      .jpeg({ quality: 85 })
      .toFile(jpegPath);

    safeUnlink(filePath);
    return jpegPath;
  } catch (error) {
    console.error('Error converting HEIC/HEIF to JPEG:', error);
    return filePath;
  }
}

// ===============================
// ✅ API Routes
// ===============================
app.get('/api/spots', requireDb, async (_req, res) => {
  try {
    console.log('📡 Fetching spots from database...');
    const spots = await Spot.find().sort({ createdAt: -1 });
    console.log(`✅ Found ${spots.length} spots`);
    res.json(attachSatellite(spots));
  } catch (error) {
    console.error('❌ Error fetching spots:', error);
    res.status(500).json({
      error: 'Database error',
      message: 'Impossibile connettersi o leggere dal database',
      details: error.message
    });
  }
});

app.get('/api/spots/:id', requireDb, async (req, res) => {
  try {
    const spot = await Spot.findById(req.params.id);
    if (!spot) return res.status(404).json({ error: 'Spot not found' });
    res.json(attachSatellite(spot));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching spot', details: error.message });
  }
});

app.get('/api/spots-minimal', requireDb, async (_req, res) => {
  try {
    const spots = await Spot.find({}, 'name _id location status lat lng').sort({ name: 1 });
    res.json(attachSatellite(spots));
  } catch (error) {
    console.error('Error fetching minimal spots:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.post('/api/spots', requireDb, async (req, res) => {
  try {
    console.log('📝 Creating new spot:', req.body?.name);
    const spotData = { ...req.body };

    if (spotData.alternativeSpots && Array.isArray(spotData.alternativeSpots)) {
      spotData.alternativeSpots = spotData.alternativeSpots
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    }

    const spot = new Spot(spotData);
    const savedSpot = await spot.save();

    console.log(`✅ Spot created with ID: ${savedSpot._id}`);
    res.status(201).json(attachSatellite(savedSpot));
  } catch (error) {
    console.error('❌ Error creating spot:', error);
    res.status(400).json({ error: 'Error creating spot', details: error.message });
  }
});

app.put('/api/spots/:id', requireDb, async (req, res) => {
  try {
    const existing = await Spot.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Spot not found' });

    const updateData = { ...req.body };

    // ✅ se non arrivano foto, mantieni le vecchie
    if (!updateData.photos && existing.photos) {
      updateData.photos = existing.photos;
    }

    if (updateData.alternativeSpots && Array.isArray(updateData.alternativeSpots)) {
      updateData.alternativeSpots = updateData.alternativeSpots
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    }

    const updatedSpot = await Spot.findByIdAndUpdate(
      req.params.id,
      { ...updateData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    console.log(`✅ Spot updated: ${updatedSpot._id}`);
    res.json(attachSatellite(updatedSpot));
  } catch (error) {
    console.error('Error updating spot:', error);
    res.status(400).json({ error: 'Error updating spot', details: error.message });
  }
});

app.delete('/api/spots/:id', requireDb, async (req, res) => {
  try {
    const spot = await Spot.findById(req.params.id);
    if (!spot) return res.status(404).json({ error: 'Spot not found' });

    // ✅ elimina anche optimized e thumb
    if (spot.photos && spot.photos.length > 0) {
      spot.photos.forEach((photoUrl) => {
        const basename = path.basename(photoUrl);
        const filePath = path.join(__dirname, 'uploads', basename);

        safeUnlink(filePath);

        // se è optimized-xxx.jpg, prova anche thumb-xxx.jpg
        if (basename.startsWith('optimized-')) {
          const originalName = basename.replace(/^optimized-/, '');
          safeUnlink(path.join(__dirname, 'uploads', originalName));
          safeUnlink(path.join(__dirname, 'uploads', `thumb-${originalName}`));
          safeUnlink(path.join(__dirname, 'uploads', `thumb-${basename}`));
        } else {
          safeUnlink(path.join(__dirname, 'uploads', `optimized-${basename}`));
          safeUnlink(path.join(__dirname, 'uploads', `thumb-${basename}`));
        }
      });
    }

    await Spot.findByIdAndDelete(req.params.id);
    console.log(`✅ Spot deleted: ${req.params.id}`);
    res.json({ message: 'Spot deleted' });
  } catch (error) {
    console.error('Error deleting spot:', error);
    res.status(500).json({ error: 'Error deleting spot', details: error.message });
  }
});

// ===============================
// ✅ Upload Endpoint (ottimizza + thumb)
// ===============================
app.post('/api/upload', upload.array('photos', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    console.log(`📸 Uploading ${req.files.length} photos...`);
    const photoUrls = [];

    for (const file of req.files) {
      try {
        let processedFilePath = file.path;

        // HEIC/HEIF -> JPG
        if (
          (file.originalname || '').toLowerCase().endsWith('.heic') ||
          (file.originalname || '').toLowerCase().endsWith('.heif')
        ) {
          processedFilePath = await convertHeicToJpeg(file.path);
        }

        // ✅ Normalizzo sempre output a .jpg (evito mismatch estensione/formato)
        const base = path.basename(file.filename, path.extname(file.filename));
        const optimizedFilename = `optimized-${base}.jpg`;
        const thumbnailFilename = `thumb-${base}.jpg`;

        const optimizedOut = path.join('uploads', optimizedFilename);
        const thumbOut = path.join('uploads', thumbnailFilename);

        await sharp(processedFilePath)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, mozjpeg: true })
          .toFile(optimizedOut);

        await sharp(processedFilePath)
          .resize(400, 400, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(thumbOut);

        // ✅ salva URL RELATIVO
        photoUrls.push(`/uploads/${optimizedFilename}`);

        // pulisco file temporaneo originale (o convertito)
        if (processedFilePath && fs.existsSync(processedFilePath)) {
          safeUnlink(processedFilePath);
        }

        // pulisco anche l’originale se diverso
        if (file.path && file.path !== processedFilePath && fs.existsSync(file.path)) {
          safeUnlink(file.path);
        }
      } catch (error) {
        console.error('Error processing image:', error);
        // fallback: restituisci il file originale caricato (relativo)
        const fallbackName = path.basename(file.path);
        photoUrls.push(`/uploads/${fallbackName}`);
      }
    }

    console.log(`✅ Photos uploaded: ${photoUrls.length} files`);
    res.json({
      message: 'Photos uploaded successfully',
      urls: photoUrls,
      count: req.files.length
    });
  } catch (error) {
    console.error('Upload error:', error);

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'File too large',
          message: 'Maximum file size is 10MB per image'
        });
      }
      if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          error: 'Too many files',
          message: 'Maximum 5 photos allowed'
        });
      }
    }

    res.status(500).json({
      error: 'Error uploading photos',
      details: error.message,
      suggestion: 'Try with smaller images or different format (JPEG recommended)'
    });
  }
});

// ===============================
// ✅ Health/Test/Info
// ===============================
app.get('/api/test', async (_req, res) => {
  try {
    const connectionState = mongoose.connection.readyState;
    const info = {
      connectionState,
      state: ['disconnected', 'connected', 'connecting', 'disconnecting'][connectionState]
    };

    if (connectionState === 1) {
      const ping = await mongoose.connection.db.admin().ping();
      info.ping = ping;
      info.databaseName = mongoose.connection.db.databaseName;
      info.collections = await mongoose.connection.db.listCollections().toArray();
    }

    res.json({
      status: connectionState === 1 ? 'OK' : 'ERROR',
      message: connectionState === 1 ? 'Database connesso' : 'Database non connesso',
      ...info
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: error.message,
      connectionState: mongoose.connection.readyState
    });
  }
});

app.get('/api/health', (_req, res) => {
  const state = mongoose.connection.readyState;
  const hasUploadsDir = fs.existsSync(uploadsDir);

  res.json({
    status: state === 1 ? 'healthy' : 'unhealthy',
    database: state === 1 ? 'connected' : 'disconnected',
    databaseState: ['disconnected', 'connected', 'connecting', 'disconnecting'][state],
    uploads: hasUploadsDir ? 'available' : 'unavailable',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api', (_req, res) => {
  res.json({
    message: 'URBEX HUD API',
    version: '4.2.0',
    features: [
      'photo-upload',
      'heic-conversion',
      'image-optimization',
      'alternative-spots',
      'satelliteImage-field'
    ],
    limits: {
      maxFileSize: '10MB',
      maxFiles: 5,
      allowedFormats: ['JPEG', 'PNG', 'GIF', 'WEBP', 'HEIC', 'HEIF']
    },
    endpoints: {
      spots: 'GET/POST /api/spots',
      spot: 'GET/PUT/DELETE /api/spots/:id',
      spotsMinimal: 'GET /api/spots-minimal',
      upload: 'POST /api/upload',
      test: 'GET /api/test',
      health: 'GET /api/health'
    },
    database: isDbConnected() ? 'connected' : 'disconnected'
  });
});

// ===============================
// ✅ Parse Coordinates utility (come il tuo)
// ===============================
app.post('/api/parse-coordinates', (req, res) => {
  try {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: 'No input provided' });

    const parsed = parseCoordinates(input);

    if (parsed) {
      res.json({ success: true, coordinates: parsed });
    } else {
      res.status(400).json({
        success: false,
        error: 'Invalid coordinate format',
        suggestions: [
          'Format: "latitude,longitude" (e.g., 45.4642,9.1900)',
          'Google Maps link: https://maps.google.com/?q=45.4642,9.1900'
        ]
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error parsing coordinates', details: error.message });
  }
});

function parseCoordinates(input) {
  input = String(input).trim();

  if (input.includes('google.com/maps') || input.includes('maps.app.goo.gl')) {
    try {
      const url = new URL(input);
      const q = url.searchParams.get('q');
      if (q) {
        const coords = q.split(',').map(Number);
        if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
          return { lat: coords[0], lng: coords[1] };
        }
      }

      const match = input.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (match) {
        return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
      }
    } catch (_e) {}
  }

  const parts = input.split(',');
  if (parts.length === 2) {
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }

  const parts2 = input.split(/[\s,;]+/);
  if (parts2.length >= 2) {
    const lat = parseFloat(parts2[0]);
    const lng = parseFloat(parts2[1]);
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }

  return null;
}

// ===============================
// ✅ Serve frontend
// ===============================
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===============================
// ✅ DB connect + seed
// ===============================
async function connectToDatabase() {
  try {
    console.log('🔄 Connessione a MongoDB Atlas...');

    if (!MONGODB_URI) throw new Error('MONGODB_URI missing');

    const options = {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      w: 'majority'
    };

    await mongoose.connect(MONGODB_URI, options);

    console.log('✅ Connesso a MongoDB Atlas');
    console.log(`📊 Database: ${mongoose.connection.db.databaseName}`);

    await mongoose.connection.db.admin().ping();
    console.log('📡 Database risponde correttamente');

    return true;
  } catch (error) {
    console.error('❌ ERRORE CONNESSIONE MONGODB:', error.message);
    console.log('\n🔧 DIAGNOSTICA:');
    console.log('1) Atlas > Network Access: whitelist IP (anche 0.0.0.0/0 per test)');
    console.log('2) Username/password corretti');
    console.log('3) URI completa (mongodb+srv://...)');
    return false;
  }
}

async function seedDatabase() {
  try {
    const count = await Spot.countDocuments();
    console.log(`📊 Documenti nel database: ${count}`);

    if (count === 0) {
      console.log('📦 Inserimento dati di esempio...');

      const sampleSpots = [
        {
          name: 'EX MANIFATTURA TABACCHI',
          location: 'Milano, Italy',
          status: 'planned',
          lat: 45.4843,
          lng: 9.1842,
          description: 'Ex tobacco factory from the 80s with original machinery.',
          planA: 'Side gate access on Via delle Industrie',
          photos: []
        },
        {
          name: 'ABANDONED HOSPITAL',
          location: 'Roma, Italy',
          status: 'completed',
          lat: 41.9028,
          lng: 12.4964,
          description: 'Old psychiatric hospital abandoned since 1999.',
          planA: 'Main entrance from the east side',
          photos: []
        },
        {
          name: 'GHOST VILLAGE',
          location: 'Abruzzo, Italy',
          status: 'planned',
          lat: 42.08,
          lng: 13.65,
          description: 'Completely abandoned medieval village.',
          planA: 'Hiking trail from nearby town',
          photos: []
        }
      ];

      const inserted = await Spot.insertMany(sampleSpots);
      console.log('✅ Dati di esempio inseriti');

      if (inserted.length >= 3) {
        await Spot.findByIdAndUpdate(inserted[0]._id, { alternativeSpots: [inserted[1]._id, inserted[2]._id] });
        await Spot.findByIdAndUpdate(inserted[1]._id, { alternativeSpots: [inserted[0]._id] });
      }
    }
  } catch (error) {
    console.error('❌ Errore durante il seed:', error.message);
  }
}

// ===============================
// ✅ Start server
// ===============================
async function startServer() {
  const PORT = process.env.PORT || 10000;

  const connected = await connectToDatabase();
  if (connected) await seedDatabase();

  app.listen(PORT, () => {
    console.log(`\n🎉 SERVER AVVIATO! (DB: ${connected ? 'OK' : 'NO'})`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    console.log(`🔧 API:      http://localhost:${PORT}/api`);
    console.log(`📸 Uploads:  http://localhost:${PORT}/uploads/`);
    console.log(`🧪 Test DB:  http://localhost:${PORT}/api/test`);
    console.log(`📊 Health:   http://localhost:${PORT}/api/health`);
  });
}

process.on('uncaughtException', (err) => {
  console.error('❌ UncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ UnhandledRejection:', reason);
});

startServer();
