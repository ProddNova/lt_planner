const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(__dirname));

// ✅ STRINGA DI CONNESSIONE CORRETTA
const MONGODB_URI = 'mongodb+srv://terrilegiacomo_db_user:Xm3IlXAPEG5WBNpQ@urbex-hud-db.okizzoq.mongodb.net/urbex-hud?retryWrites=true&w=majority&appName=urbex-hud-db';

console.log('🔧 Tentativo di connessione con stringa:', MONGODB_URI.replace(/Xm3IlXAPEG5WBNpQ/, '***'));

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
            message: 'Impossibile connettersi al database'
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

// Test route
app.get('/api/test', async (req, res) => {
    try {
        // Test semplice della connessione
        await mongoose.connection.db.admin().ping();
        res.json({ 
            status: 'OK', 
            message: 'Database connesso',
            connectionState: mongoose.connection.readyState 
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'ERROR', 
            message: error.message,
            connectionState: mongoose.connection.readyState 
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Info API
app.get('/api', (req, res) => {
    res.json({ 
        message: 'URBEX HUD API',
        version: '1.0.0',
        endpoints: {
            spots: '/api/spots',
            test: '/api/test',
            health: '/api/health'
        }
    });
});

// Serve frontend per tutte le altre rotte
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Connessione al database e avvio server
async function startServer() {
    try {
        console.log('🔄 Connessione a MongoDB Atlas...');
        
        // Opzioni di connessione
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
        
        // Verifica la connessione
        await mongoose.connection.db.admin().ping();
        console.log('📊 Database risponde correttamente');
        
        // Crea qualche dato di esempio se il database è vuoto
        const count = await Spot.countDocuments();
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
                    description: "Former tobacco factory abandoned since the 80s.",
                    planA: "Access from side gate on Via delle Industrie.",
                    planB: "Gap in rear fence near silos.",
                    photos: [
                        "https://images.unsplash.com/photo-1581094794329-c8112a89af12?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                    ]
                }
            ];
            await Spot.insertMany(sampleSpots);
            console.log('✅ Dati di esempio inseriti');
        }
        
        // Avvia il server
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 Server in esecuzione sulla porta ${PORT}`);
            console.log(`🌐 Frontend: http://localhost:${PORT}`);
            console.log(`🔧 API: http://localhost:${PORT}/api`);
            console.log(`🧪 Test DB: http://localhost:${PORT}/api/test`);
        });
        
    } catch (error) {
        console.error('❌ ERRORE CRITICO:', error.message);
        console.log('\n🔧 PROBLEMI COMUNI E SOLUZIONI:');
        console.log('1. Verifica che la password sia corretta');
        console.log('2. Vai su MongoDB Atlas > Network Access > Add IP Address > Allow Access from Anywhere');
        console.log('3. Verifica che l\'utente "terrilegiacomo_db_user" abbia permessi di lettura/scrittura');
        console.log('4. Controlla che il cluster sia attivo (non in pausa)');
        
        // Avvia comunque il server (ma senza database)
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`⚠️ Server avviato SENZA database sulla porta ${PORT}`);
            console.log(`📱 Frontend funzionante: http://localhost:${PORT}`);
            console.log(`❌ API database non disponibili`);
        });
    }
}

// Gestione errori non catturati
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

// Avvia tutto
startServer();
