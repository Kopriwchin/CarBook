const express = require('express');
const router = express.Router();
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

router.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        
        const vehicles = await Vehicle.find({ owner: req.session.userId });
        
        const usedSlots = vehicles.length;
        const totalSlots = user.carLimit;
        
        res.render('dashboard', { 
            vehicles, 
            usedSlots, 
            totalSlots 
        });
    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

router.get('/add-vehicle', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const vehicleCount = await Vehicle.countDocuments({ owner: req.session.userId });

    if (vehicleCount >= user.carLimit) {
        return res.render('shop/limit_reached', { limit: user.carLimit });
    }

    res.render('add-vehicle', { error: null });
});

router.post('/add-vehicle', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const vehicleCount = await Vehicle.countDocuments({ owner: req.session.userId });

    if (vehicleCount >= user.carLimit) {
        return res.redirect('/shop');
    }

    const { brand, model, manufactureDate, color, regPlate, fuelType, insuranceExpiry } = req.body;
    
    try {
        const vehicle = new Vehicle({
            owner: req.session.userId,
            brand,
            model,
            manufactureDate,
            color,
            regPlate,
            fuelType,
            insuranceExpiry
        });
        await vehicle.save();
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('add-vehicle', { error: 'Възникна грешка при добавянето.' });
    }
});

router.post('/delete-vehicle/:id', requireLogin, async (req, res) => {
    try {
        await Vehicle.findOneAndDelete({ _id: req.params.id, owner: req.session.userId });
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
});

module.exports = router;