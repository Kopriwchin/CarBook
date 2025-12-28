const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const checkRoutes = require('./routes/checks');
const shopRoutes = require('./routes/shop'); 

const app = express();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

app.use(authRoutes);
app.use(vehicleRoutes);
app.use(checkRoutes);
app.use(shopRoutes); 

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));