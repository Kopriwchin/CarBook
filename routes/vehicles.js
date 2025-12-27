// routes/vehicles.js
const express = require('express');
const router = express.Router();
const Vehicle = require('../models/Vehicle'); // Import the model we made earlier

// Middleware to check if user is logged in
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
};

// GET: Dashboard (List all vehicles)
router.get('/dashboard', requireLogin, async (req, res) => {
    try {
        // Find vehicles belonging to the logged-in user
        const vehicles = await Vehicle.find({ owner: req.session.userId });
        res.render('dashboard', { vehicles });
    } catch (err) {
        console.error(err);
        res.render('dashboard', { vehicles: [], error: 'Could not load vehicles.' });
    }
});

// GET: Add Vehicle Form
router.get('/add-vehicle', requireLogin, (req, res) => {
    res.render('add-vehicle');
});

router.post('/add-vehicle', requireLogin, async (req, res) => {
    const { brand, model, manufactureDate, regPlate, color, fuelType } = req.body;

    try {
        const newCar = new Vehicle({
            owner: req.session.userId,
            brand,
            model,
            manufactureDate,
            regPlate: regPlate.toUpperCase(),
            color,
            fuelType
        });
        
        await newCar.save();
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('add-vehicle', { 
            error: 'Грешка при добавяне. Регистрационният номер може вече да съществува.',
            formData: req.body 
        });
    }
});

module.exports = router;