const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// ✅ IMPORTANTISSIMO se deploy dietro proxy (Render, Nginx, ecc.)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve frontend
app.use(express.static(__dirname));

// ✅ URI fissa (come richiesto)
const MONGODB_URI = 'mongodb+srv://terrilegiacomo_db_user:Prova019283@urbex-hud-db.okizzoq.mongodb.net/urbex-hud?retryWrites=true&w=majority&appName=urbex-hud-db';

console.log('🔧 Tentativo di connessione MongoDB...');

// ✅ Fail-fast: se DB è giù non bufferizza comandi
mongoose.set('bufferCommands', false);

// log utili
mongoose.connection.on('connected', () => console.log('✅ Mongo connected'));
mongoose.connection.on('error', (e) => console.log('❌ Mongo error:', e.message));
mongoose.connection.on('disconnected', () => console.log('⚠️ Mongo disconnected'));
mongoose.connection.on('reconnected', () => console.log('🔁 Mongo reconnected'));

// ===============================
// ✅ Schema Spot (NO FOTO)
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
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

spotSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Spot = mongoose.model('Spot', spotSchema);

// ===============================
// ✅ Helpers DB
// ===============================
function isDbConnected() {
    return mongoose.connection.readyState === 1;
}

function requireDb(_req, res, next) {
    if (!isDbConnected()) {
        return res.status(503).json({
            error: 'Database not connected',
            message: 'MongoDB non connesso. Controlla Atlas whitelist IP / credenziali.',
            databaseState: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState]
        });
    }
    next();
}

// ===============================
// ✅ Satellite URL (free/no key) - Esri Export
// ===============================
function latLngToWebMercator(lat, lng) {
    const x = (lng * 20037508.34) / 180;
    let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    y = (y * 20037508.34) / 180;
    return { x, y };
}

function buildEsriStaticImage(lat, lng, zoom = 19, width = 900, height = 500) {
    const { x, y } = latLngToWebMercator(lat, lng);
    const initialRes = 156543.03392804097;
    const res = initialRes / Math.pow(2, zoom);

    const halfW = (width / 2) * res;
    const halfH = (height / 2) * res;

    const bbox = `${x - halfW},${y - halfH},${x + halfW},${y + halfH}`;

    return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
        `?bbox=${encodeURIComponent(bbox)}` +
        '&bboxSR=3857&imageSR=3857' +
        `&size=${width},${height}` +
        '&format=jpg&f=image';
}

function attachSatellite(docOrDocs) {
    const add = (s) => {
        if (!s) return s;
        const obj = (typeof s.toObject === 'function') ? s.toObject() : s;
        if (typeof obj.lat === 'number' && typeof obj.lng === 'number') {
            obj.satelliteImage = buildEsriStaticImage(obj.lat, obj.lng, 19, 900, 500);
            obj.satelliteImageLarge = buildEsriStaticImage(obj.lat, obj.lng, 19, 1200, 800);
        } else {
            obj.satelliteImage = null;
            obj.satelliteImageLarge = null;
        }
        return obj;
    };
    return Array.isArray(docOrDocs) ? docOrDocs.map(add) : add(docOrDocs);
}

// ===============================
// ✅ API Routes
// ===============================
app.get('/api/spots', requireDb, async (_req, res) => {
    try {
        const spots = await Spot.find().sort({ createdAt: -1 });
        res.json(attachSatellite(spots));
    } catch (error) {
        console.error('❌ Error fetching spots:', error);
        res.status(500).json({
            error: 'Database error',
            message: 'Impossibile leggere gli spot',
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
        const spotData = { ...req.body };

        if (spotData.alternativeSpots && Array.isArray(spotData.alternativeSpots)) {
            spotData.alternativeSpots = spotData.alternativeSpots
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
        }

        const spot = new Spot(spotData);
        const savedSpot = await spot.save();
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

        if (updateData.alternativeSpots && Array.isArray(updateData.alternativeSpots)) {
            updateData.alternativeSpots = updateData.alternativeSpots
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
        }

        const updatedSpot = await Spot.findByIdAndUpdate(
            req.params.id,
            { ...updateData, updatedAt: Date.now() },
            { new: true, runValidators: true }
        );

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

        await Spot.findByIdAndDelete(req.params.id);
        res.json({ message: 'Spot deleted' });
    } catch (error) {
        console.error('Error deleting spot:', error);
        res.status(500).json({ error: 'Error deleting spot', details: error.message });
    }
});

app.get('/api/test', async (_req, res) => {
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

app.get('/api/health', (_req, res) => {
    const state = mongoose.connection.readyState;

    res.json({
        status: state === 1 ? 'healthy' : 'unhealthy',
        database: state === 1 ? 'connected' : 'disconnected',
        databaseState: ['disconnected', 'connected', 'connecting', 'disconnecting'][state],
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.get('/api', (_req, res) => {
    res.json({
        message: 'URBEX HUD API',
        version: '5.0.0',
        features: ['no-photos', 'satellite-only', 'alternative-spots', 'gmaps-buttons'],
        endpoints: {
            spots: 'GET/POST /api/spots',
            spot: 'GET/PUT/DELETE /api/spots/:id',
            spotsMinimal: 'GET /api/spots-minimal',
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
        } catch (e) {}
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

// Serve frontend
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Connessione al database
async function connectToDatabase() {
    try {
        console.log('🔄 Connessione a MongoDB Atlas...');

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
        console.log('3) URI completa in server.js');
        return false;
    }
}

// Seed database
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
                    lat: 45.4843,
                    lng: 9.1842,
                    description: "Ex tobacco factory from the 80s with original machinery.",
                    planA: "Side gate access on Via delle Industrie"
                },
                {
                    name: "ABANDONED HOSPITAL",
                    location: "Roma, Italy",
                    status: "completed",
                    lat: 41.9028,
                    lng: 12.4964,
                    description: "Old psychiatric hospital abandoned since 1999.",
                    planA: "Main entrance from the east side"
                },
                {
                    name: "GHOST VILLAGE",
                    location: "Abruzzo, Italy",
                    status: "planned",
                    lat: 42.0800,
                    lng: 13.6500,
                    description: "Completely abandoned medieval village.",
                    planA: "Hiking trail from nearby town"
                }
            ];

            const insertedSpots = await Spot.insertMany(sampleSpots);
            console.log('✅ Dati di esempio inseriti');

            if (insertedSpots.length >= 3) {
                await Spot.findByIdAndUpdate(insertedSpots[0]._id, {
                    alternativeSpots: [insertedSpots[1]._id, insertedSpots[2]._id]
                });

                await Spot.findByIdAndUpdate(insertedSpots[1]._id, {
                    alternativeSpots: [insertedSpots[0]._id]
                });
            }
        }
    } catch (error) {
        console.error('❌ Errore durante il seed:', error.message);
    }
}

// Start server
async function startServer() {
    const PORT = process.env.PORT || 10000;

    const connected = await connectToDatabase();
    if (connected) await seedDatabase();

    app.listen(PORT, () => {
        console.log(`\n🎉 SERVER AVVIATO! (DB: ${connected ? 'OK' : 'NO'})`);
        console.log(`🌐 Frontend: http://localhost:${PORT}`);
        console.log(`🔧 API: http://localhost:${PORT}/api`);
        console.log(`🧪 Test DB: http://localhost:${PORT}/api/test`);
        console.log(`📊 Health: http://localhost:${PORT}/api/health`);
    });
}

process.on('uncaughtException', (err) => {
    console.error('❌ Errore non gestito:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Promise non gestita:', reason);
});

startServer();
