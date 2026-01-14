const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ✅ STRINGA DI CONNESSIONE
const MONGODB_URI = 'mongodb+srv://terrilegiacomo_db_user:Prova019283@urbex-hud-db.okizzoq.mongodb.net/urbex-hud?retryWrites=true&w=majority&appName=urbex-hud-db';

console.log('🔧 Tentativo di connessione MongoDB...');

// Configurazione Multer per upload foto
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
   
    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'));
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    }
});

// Schema per gli spots
const spotSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    location: { type: String, required: true },
    status: {
        type: String,
        enum: ['planned', 'active', 'completed'],
        default: 'planned'
    },
    date: { type: Date },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    description: { type: String, required: true },
    planA: { type: String },
    planB: { type: String },
    photos: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

spotSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Spot = mongoose.model('Spot', spotSchema);

// API Routes
app.get('/api/spots', async (req, res) => {
    try {
        const spots = await Spot.find().sort({ createdAt: -1 });
        res.json(spots);
    } catch (error) {
        console.error('Error fetching spots:', error);
        res.status(500).json({
            error: 'Database error',
            message: 'Impossibile connettersi al database',
            details: error.message
        });
    }
});

app.get('/api/spots/:id', async (req, res) => {
    try {
        const spot = await Spot.findById(req.params.id);
        if (!spot) return res.status(404).json({ error: 'Spot not found' });
        res.json(spot);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching spot' });
    }
});

app.post('/api/spots', async (req, res) => {
    try {
        const spot = new Spot(req.body);
        const savedSpot = await spot.save();
        res.status(201).json(savedSpot);
    } catch (error) {
        console.error('Error creating spot:', error);
        res.status(400).json({ error: 'Error creating spot', details: error.message });
    }
});

app.put('/api/spots/:id', async (req, res) => {
    try {
        const spot = await Spot.findById(req.params.id);
        if (!spot) return res.status(404).json({ error: 'Spot not found' });

        // Conserva le foto esistenti se non vengono inviate nuove foto
        const updateData = { ...req.body };
        if (!updateData.photos && spot.photos) {
            updateData.photos = spot.photos;
        }

        const updatedSpot = await Spot.findByIdAndUpdate(
            req.params.id,
            { ...updateData, updatedAt: Date.now() },
            { new: true, runValidators: true }
        );
        
        res.json(updatedSpot);
    } catch (error) {
        console.error('Error updating spot:', error);
        res.status(400).json({ error: 'Error updating spot', details: error.message });
    }
});

app.delete('/api/spots/:id', async (req, res) => {
    try {
        const spot = await Spot.findById(req.params.id);
        if (!spot) return res.status(404).json({ error: 'Spot not found' });
       
        // Cancella le foto associate
        if (spot.photos && spot.photos.length > 0) {
            spot.photos.forEach(photoUrl => {
                if (photoUrl.includes('/uploads/')) {
                    const filename = path.basename(photoUrl);
                    const filePath = path.join(__dirname, 'uploads', filename);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            });
        }
       
        await Spot.findByIdAndDelete(req.params.id);
        res.json({ message: 'Spot deleted' });
    } catch (error) {
        console.error('Error deleting spot:', error);
        res.status(500).json({ error: 'Error deleting spot', details: error.message });
    }
});

// Endpoint per upload foto con ottimizzazione
app.post('/api/upload', upload.array('photos', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
       
        const photoUrls = [];
       
        for (const file of req.files) {
            try {
                // Crea thumbnail
                const thumbnailFilename = `thumb-${file.filename}`;
                const thumbnailPath = path.join('uploads', thumbnailFilename);
               
                // Ottimizza l'immagine principale (mantenendo le proporzioni)
                await sharp(file.path)
                    .resize(1200, 800, { 
                        fit: 'inside',
                        withoutEnlargement: true 
                    })
                    .jpeg({ quality: 85 })
                    .toFile(path.join('uploads', `optimized-${file.filename}`));
               
                // Crea thumbnail
                await sharp(file.path)
                    .resize(400, 300, { 
                        fit: 'cover',
                        position: 'center'
                    })
                    .jpeg({ quality: 80 })
                    .toFile(thumbnailPath);
               
                // URL per l'immagine ottimizzata e thumbnail
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                photoUrls.push(`${baseUrl}/uploads/optimized-${file.filename}`);
               
                // Cancella il file originale non ottimizzato
                fs.unlinkSync(file.path);
               
            } catch (error) {
                console.error('Error processing image:', error);
                // Fallback: usa il file originale
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                photoUrls.push(`${baseUrl}/uploads/${file.filename}`);
            }
        }
       
        res.json({
            message: 'Photos uploaded successfully',
            urls: photoUrls,
            count: req.files.length
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Error uploading photos', details: error.message });
    }
});

// Endpoint per cancellare foto specifiche
app.delete('/api/photos/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, 'uploads', filename);
        const thumbPath = path.join(__dirname, 'uploads', `thumb-${filename}`);
        const optimizedPath = path.join(__dirname, 'uploads', `optimized-${filename}`);
       
        [filePath, thumbPath, optimizedPath].forEach(path => {
            if (fs.existsSync(path)) {
                fs.unlinkSync(path);
            }
        });
       
        res.json({ message: 'Photo deleted' });
    } catch (error) {
        console.error('Error deleting photo:', error);
        res.status(500).json({ error: 'Error deleting photo' });
    }
});

// Endpoint per cancellare foto da uno spot (mantenendo le altre)
app.delete('/api/spots/:id/photos', async (req, res) => {
    try {
        const { photoUrl } = req.body;
        if (!photoUrl) {
            return res.status(400).json({ error: 'Photo URL required' });
        }
       
        const spot = await Spot.findById(req.params.id);
        if (!spot) return res.status(404).json({ error: 'Spot not found' });
       
        // Rimuovi la foto dall'array
        spot.photos = spot.photos.filter(photo => photo !== photoUrl);
        await spot.save();
       
        // Cancella il file fisico se è un upload locale
        if (photoUrl.includes('/uploads/')) {
            const filename = path.basename(photoUrl);
            const filePath = path.join(__dirname, 'uploads', filename);
            const thumbPath = path.join(__dirname, 'uploads', `thumb-${filename}`);
            const optimizedPath = path.join(__dirname, 'uploads', `optimized-${filename}`);
           
            [filePath, thumbPath, optimizedPath].forEach(path => {
                if (fs.existsSync(path)) {
                    fs.unlinkSync(path);
                }
            });
        }
       
        res.json({ message: 'Photo removed from spot', spot });
    } catch (error) {
        console.error('Error removing photo:', error);
        res.status(500).json({ error: 'Error removing photo' });
    }
});

// Test route con dettagli
app.get('/api/test', async (req, res) => {
    try {
        const connectionState = mongoose.connection.readyState;
        let dbInfo = {
            connectionState: connectionState,
            state: ['disconnected', 'connected', 'connecting', 'disconnecting'][connectionState]
        };
       
        if (connectionState === 1) {
            const ping = await mongoose.connection.db.admin().ping();
            dbInfo.ping = ping;
            dbInfo.databaseName = mongoose.connection.db.databaseName;
            dbInfo.collections = await mongoose.connection.db.listCollections().toArray();
        }
       
        res.json({
            status: connectionState === 1 ? 'OK' : 'ERROR',
            message: connectionState === 1 ? 'Database connesso' : 'Database non connesso',
            ...dbInfo
        });
    } catch (error) {
        res.status(500).json({
            status: 'ERROR',
            message: error.message,
            connectionState: mongoose.connection.readyState
        });
    }
});

// Health check dettagliato
app.get('/api/health', (req, res) => {
    const state = mongoose.connection.readyState;
    const uploadsDir = path.join(__dirname, 'uploads');
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

// Info API
app.get('/api', (req, res) => {
    res.json({
        message: 'URBEX HUD API',
        version: '1.4.0',
        features: ['photo-upload', 'mobile-optimized', 'coordinates-parser', 'photo-cropping', 'image-optimization'],
        endpoints: {
            spots: 'GET/POST /api/spots',
            spot: 'GET/PUT/DELETE /api/spots/:id',
            upload: 'POST /api/upload',
            deletePhoto: 'DELETE /api/photos/:filename',
            deleteSpotPhoto: 'DELETE /api/spots/:id/photos',
            test: 'GET /api/test',
            health: 'GET /api/health'
        },
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Parse coordinates utility
app.post('/api/parse-coordinates', (req, res) => {
    try {
        const { input } = req.body;
       
        if (!input) {
            return res.status(400).json({ error: 'No input provided' });
        }
       
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
        res.status(500).json({ error: 'Error parsing coordinates' });
    }
});

// Funzione helper per parse coordinates
function parseCoordinates(input) {
    input = input.trim();
   
    // Se è un link Google Maps
    if (input.includes('google.com/maps') || input.includes('maps.app.goo.gl')) {
        try {
            // Estrai le coordinate dal link
            const url = new URL(input);
            const q = url.searchParams.get('q');
            if (q) {
                const coords = q.split(',').map(Number);
                if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                    return { lat: coords[0], lng: coords[1] };
                }
            }
           
            // Prova con @ formato (es: @45.4642,9.1900,15z)
            const match = input.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (match) {
                return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
            }
        } catch (e) {
            // Continua con altri metodi
        }
    }
   
    // Se è nel formato "lat,lng"
    const parts = input.split(',');
    if (parts.length === 2) {
        const lat = parseFloat(parts[0].trim());
        const lng = parseFloat(parts[1].trim());
        if (!isNaN(lat) && !isNaN(lng)) {
            return { lat, lng };
        }
    }
   
    // Se è nel formato "lat lng"
    const parts2 = input.split(/[\s,;]+/);
    if (parts2.length >= 2) {
        const lat = parseFloat(parts2[0]);
        const lng = parseFloat(parts2[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
            return { lat, lng };
        }
    }
   
    return null;
}

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Connessione al database
async function connectToDatabase() {
    try {
        console.log('🔄 Connessione a MongoDB Atlas...');
       
        const options = {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            retryWrites: true,
            w: 'majority'
        };
       
        await mongoose.connect(MONGODB_URI, options);
        console.log('✅ Connesso a MongoDB Atlas');
        console.log(`📊 Database: ${mongoose.connection.db.databaseName}`);
       
        // Test ping
        await mongoose.connection.db.admin().ping();
        console.log('📡 Database risponde correttamente');
       
        return true;
    } catch (error) {
        console.error('❌ ERRORE CONNESSIONE MONGODB:', error.message);
        console.log('\n🔧 DIAGNOSTICA:');
        console.log('1. Controlla MongoDB Atlas > Network Access > IP 0.0.0.0/0');
        console.log('2. Controlla che la password sia corretta: Prova019283');
        console.log('3. Controlla che l\'utente abbia permessi');
        console.log('4. Stringa usata:', MONGODB_URI.replace(/Prova019283/, '***'));
       
        return false;
    }
}

// Inserisci dati di esempio
async function seedDatabase() {
    try {
        const count = await Spot.countDocuments();
        console.log(`📊 Documenti nel database: ${count}`);
       
        if (count === 0) {
            console.log('📦 Inserimento dati di esempio...');
            const sampleSpots = [
                {
                    name: "EX MANIFATTURA TABACCHI",
                    location: "Milano, Italy",
                    status: "planned",
                    date: new Date("2024-06-15"),
                    lat: 45.4843,
                    lng: 9.1842,
                    description: "Ex tobacco factory from the 80s with original machinery.",
                    planA: "Side gate access on Via delle Industrie",
                    planB: "Gap in rear fence",
                    photos: [
                        "https://images.unsplash.com/photo-1581094794329-c8112a89af12?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                    ]
                },
                {
                    name: "ABANDONED HOSPITAL",
                    location: "Roma, Italy",
                    status: "active",
                    date: new Date("2024-06-20"),
                    lat: 41.9028,
                    lng: 12.4964,
                    description: "Old psychiatric hospital abandoned since 1999.",
                    planA: "Main entrance from the east side",
                    planB: "Broken window on ground floor",
                    photos: [
                        "https://images.unsplash.com/photo-1551601651-2a8555f1a136?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                    ]
                }
            ];
            await Spot.insertMany(sampleSpots);
            console.log('✅ Dati di esempio inseriti');
        }
       
        // Crea directory uploads se non esiste
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
            console.log('📁 Cartella uploads creata');
        }
    } catch (error) {
        console.error('❌ Errore durante il seed:', error.message);
    }
}

// Avvio server
async function startServer() {
    const PORT = process.env.PORT || 10000;
   
    // Installa dipendenze mancanti
    try {
        const requiredModules = ['multer', 'sharp'];
        console.log('📦 Verifica dipendenze...');
       
        for (const module of requiredModules) {
            try {
                require.resolve(module);
                console.log(`✅ ${module} installato`);
            } catch (e) {
                console.log(`⚠️ ${module} non installato. Esegui: npm install ${module}`);
            }
        }
    } catch (error) {
        console.log('⚠️ Non è stato possibile verificare le dipendenze');
    }
   
    // Prova a connetterti
    const connected = await connectToDatabase();
   
    if (connected) {
        // Inserisci dati di esempio e crea cartelle
        await seedDatabase();
       
        app.listen(PORT, () => {
            console.log(`\n🎉 SERVER AVVIATO CON SUCCESSO!`);
            console.log(`🌐 Frontend: http://localhost:${PORT}`);
            console.log(`🔧 API: http://localhost:${PORT}/api`);
            console.log(`📸 Uploads: http://localhost:${PORT}/uploads/`);
            console.log(`🧪 Test DB: http://localhost:${PORT}/api/test`);
            console.log(`📊 Health: http://localhost:${PORT}/api/health`);
            console.log('\n✨ NOVITÀ DELLA VERSIONE 1.4.0:');
            console.log('• Feature: Crop delle immagini con modal dedicato');
            console.log('• Feature: Seleziona aspect ratio (16:9, 4:3, 1:1, Free)');
            console.log('• Feature: Ruota e zoom delle immagini');
            console.log('• Miglioramento: Ottimizzazione automatica delle immagini');
            console.log('• Fix: Le immagini non vengono più stretchate');
        });
    } else {
        // Avvia senza database
        app.listen(PORT, () => {
            console.log(`\n⚠️  SERVER AVVIATO SENZA DATABASE`);
            console.log(`🌐 Frontend: http://localhost:${PORT}`);
            console.log(`❌ API database non disponibili`);
            console.log(`💡 Controlla i logs sopra per diagnosticare il problema`);
        });
    }
}

// Gestione errori non catturati
process.on('uncaughtException', (err) => {
    console.error('❌ Errore non gestito:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise non gestita:', reason);
});

// Avvia tutto
startServer();
