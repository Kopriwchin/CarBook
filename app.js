require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');

const MongoStore = require('connect-mongo').default;
const app = express();

const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const checkRoutes = require('./routes/checks');

// 1. Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ DB Connection Error:', err));

// 2. Middleware (Settings)
app.set('view engine', 'ejs'); // Use EJS for HTML
app.use(express.urlencoded({ extended: true })); // Parse form data (POST requests)
app.use(express.static('public')); // Serve CSS/JS from public folder

// 3. Session Setup (Login state)
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

app.use((req, res, next) => {
    res.locals.userId = req.session.userId;
    res.locals.userEmail = req.session.userEmail;
    next();
});

app.use(authRoutes);
app.use(vehicleRoutes);
app.use(checkRoutes);

app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.send(`<h1>Dashboard</h1><p>You are logged in! User ID: ${req.session.userId}</p><a href='/logout'>Logout</a>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});