const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ✅ STRINGA DI CONNESSIONE AGGIORNATA CON LA NUOVA PASSWORD
const MONGODB_URI = 'mongodb+srv://terrilegiacomo_db_user:Prova019283@urbex-hud-db.okizzoq.mongodb.net/urbex-hud?retryWrites=true&w=majority&appName=urbex-hud-db';

console.log('🔧 Tentativo di connessione MongoDB...');

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
        res.status(400).json({ error: 'Error creating spot' });
    }
});

app.put('/api/spots/:id', async (req, res) => {
    try {
        const spot = await Spot.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: Date.now() },
            { new: true }
        );
        if (!spot) return res.status(404).json({ error: 'Spot not found' });
        res.json(spot);
    } catch (error) {
        res.status(400).json({ error: 'Error updating spot' });
    }
});

app.delete('/api/spots/:id', async (req, res) => {
    try {
        const spot = await Spot.findByIdAndDelete(req.params.id);
        if (!spot) return res.status(404).json({ error: 'Spot not found' });
        res.json({ message: 'Spot deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Error deleting spot' });
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
    res.json({ 
        status: state === 1 ? 'healthy' : 'unhealthy',
        database: state === 1 ? 'connected' : 'disconnected',
        databaseState: ['disconnected', 'connected', 'connecting', 'disconnecting'][state],
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Info API
app.get('/api', (req, res) => {
    res.json({ 
        message: 'URBEX HUD API',
        version: '1.0.0',
        endpoints: {
            spots: 'GET/POST /api/spots',
            spot: 'GET/PUT/DELETE /api/spots/:id',
            test: 'GET /api/test',
            health: 'GET /api/health'
        },
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

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
                }
            ];
            await Spot.insertMany(sampleSpots);
            console.log('✅ Dati di esempio inseriti');
        }
    } catch (error) {
        console.error('❌ Errore durante il seed:', error.message);
    }
}

// Avvio server
async function startServer() {
    const PORT = process.env.PORT || 10000;
    
    // Prova a connetterti
    const connected = await connectToDatabase();
    
    if (connected) {
        // Inserisci dati di esempio
        await seedDatabase();
        
        app.listen(PORT, () => {
            console.log(`\n🎉 SERVER AVVIATO CON SUCCESSO!`);
            console.log(`🌐 Frontend: https://lt-planner.onrender.com`);
            console.log(`🔧 API: https://lt-planner.onrender.com/api`);
            console.log(`🧪 Test DB: https://lt-planner.onrender.com/api/test`);
            console.log(`📊 Health: https://lt-planner.onrender.com/api/health`);
        });
    } else {
        // Avvia senza database
        app.listen(PORT, () => {
            console.log(`\n⚠️  SERVER AVVIATO SENZA DATABASE`);
            console.log(`🌐 Frontend: https://lt-planner.onrender.com`);
            console.log(`❌ API database non disponibili`);
            console.log(`💡 Controlla i logs sopra per diagnosticare il problema`);
        });
    }
}

// Avvia tutto
startServer();
