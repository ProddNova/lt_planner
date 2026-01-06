const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(__dirname));

// MongoDB Connection String (usa le tue credenziali)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://terrilegiacomo_db_user:Xm3IlXAPEG5WBNpQ@urbex-hud-db.okizzoq.mongodb.net/?appName=urbex-hud-db';

// Connessione a MongoDB
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB Atlas'))
.catch(err => {
    console.error('❌ MongoDB connection error:', err);
    console.log('🔧 Attempting to connect with encoded password...');
    
    // Prova con password encoded
    const encodedURI = 'mongodb+srv://terrilegiacomo_db_user:Xm3IlXAPEG5WBNpQ@urbex-hud-db.mongodb.net/urbex-hud?retryWrites=true&w=majority';
    mongoose.connect(encodedURI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    })
    .then(() => console.log('✅ Connected with encoded password'))
    .catch(err2 => console.error('❌ Double connection error:', err2));
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

// GET tutti gli spots
app.get('/api/spots', async (req, res) => {
    try {
        const spots = await Spot.find().sort({ createdAt: -1 });
        res.json(spots);
    } catch (error) {
        console.error('Error fetching spots:', error);
        res.status(500).json({ error: 'Error fetching spots' });
    }
});

// GET spot per ID
app.get('/api/spots/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }
        
        const spot = await Spot.findById(req.params.id);
        if (!spot) {
            return res.status(404).json({ error: 'Spot not found' });
        }
        res.json(spot);
    } catch (error) {
        console.error('Error fetching spot:', error);
        res.status(500).json({ error: 'Error fetching spot' });
    }
});

// POST nuovo spot
app.post('/api/spots', async (req, res) => {
    try {
        // Validazione base
        if (!req.body.name || !req.body.location || !req.body.lat || !req.body.lng) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const spot = new Spot(req.body);
        const savedSpot = await spot.save();
        res.status(201).json(savedSpot);
    } catch (error) {
        console.error('Error creating spot:', error);
        res.status(400).json({ error: 'Error creating spot' });
    }
});

// PUT aggiorna spot
app.put('/api/spots/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }
        
        const spot = await Spot.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: Date.now() },
            { new: true, runValidators: true }
        );
        
        if (!spot) {
            return res.status(404).json({ error: 'Spot not found' });
        }
        
        res.json(spot);
    } catch (error) {
        console.error('Error updating spot:', error);
        res.status(400).json({ error: 'Error updating spot' });
    }
});

// DELETE spot
app.delete('/api/spots/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }
        
        const spot = await Spot.findByIdAndDelete(req.params.id);
        
        if (!spot) {
            return res.status(404).json({ error: 'Spot not found' });
        }
        
        res.json({ message: 'Spot deleted successfully' });
    } catch (error) {
        console.error('Error deleting spot:', error);
        res.status(500).json({ error: 'Error deleting spot' });
    }
});

// Inserisci dati di esempio se il database è vuoto
async function seedDatabase() {
    try {
        const count = await Spot.countDocuments();
        if (count === 0) {
            const sampleSpots = [
                {
                    name: "EX MANIFATTURA TABACCHI",
                    location: "Milano, Italy",
                    status: "planned",
                    date: new Date("2024-06-15"),
                    lat: 45.4843,
                    lng: 9.1842,
                    description: "Former tobacco factory abandoned since the 80s. Massive industrial building with original machinery still in place. The boiler room is perfect for dramatic shots. Built in 1923, it was one of Italy's most modern tobacco processing plants. Operations ceased in 1985 when production moved outside the city. Rumors say it was used as an air raid shelter during WWII. You can still find old accounting ledgers in the abandoned offices.",
                    planA: "Access from side gate on Via delle Industrie. Saturday afternoon when the area is deserted.",
                    planB: "Gap in rear fence near silos. Watch for barbed wire.",
                    photos: [
                        "https://images.unsplash.com/photo-1581094794329-c8112a89af12?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
                        "https://images.unsplash.com/photo-1581094794328-e5c6f5d164e9?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                    ]
                },
                {
                    name: "VILLA LIBERTY",
                    location: "Lake Como, Brunate",
                    status: "active",
                    date: new Date("2024-06-08"),
                    lat: 45.8172,
                    lng: 9.0963,
                    description: "Art Nouveau villa from early 1900s, completely furnished. Period furniture and frescoes still visible. Built in 1908 for a wealthy textile industrial family. Abandoned since the 60s after a complex inheritance dispute. The garden, once meticulously maintained, has been reclaimed by nature in a suggestive way. The main staircase is a masterpiece of wrought iron.",
                    planA: "Enter through the back garden. Late afternoon for best lighting.",
                    planB: "Semi-open window in the dependency. More risky but direct access.",
                    photos: [
                        "https://images.unsplash.com/photo-1513584684374-8bab748fbf90?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
                        "https://images.unsplash.com/photo-1513584684374-8bab748fbf91?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                    ]
                },
                {
                    name: "EX PSYCHIATRIC HOSPITAL",
                    location: "Bolognese Apennines",
                    status: "completed",
                    date: new Date("2024-05-20"),
                    lat: 44.4949,
                    lng: 11.3426,
                    description: "Hospital structure closed in the 90s. 200-meter long corridors and containment rooms. Opened in 1890 as a provincial asylum, definitively closed in 1998 after the Basaglia Law. The chapel inside preserves frescoes depicting saints protecting the sick. In the rooms you can still find beds with restraint straps, medical records from the 60s and period medical instruments.",
                    planA: "Main entrance. Friday night for atmosphere.",
                    planB: "Side entrance from laundry through broken window.",
                    photos: [
                        "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
                        "https://images.unsplash.com/photo-1558618666-fcd25c85cd65?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                    ]
                }
            ];
            
            await Spot.insertMany(sampleSpots);
            console.log('📦 Sample data inserted');
        }
    } catch (error) {
        console.error('Error seeding database:', error);
    }
}

// API Info
app.get('/api', (req, res) => {
    res.json({ 
        message: 'URBEX HUD API',
        version: '1.0.0',
        endpoints: [
            'GET    /api/spots',
            'GET    /api/spots/:id',
            'POST   /api/spots',
            'PUT    /api/spots/:id',
            'DELETE /api/spots/:id'
        ]
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Serve frontend per tutte le altre rotte
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Porta
const PORT = process.env.PORT || 3000;

// Avvia server dopo aver inserito i dati di esempio
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    console.log(`🔧 API: http://localhost:${PORT}/api`);
    
    // Inserisci dati di esempio
    await seedDatabase();
});
