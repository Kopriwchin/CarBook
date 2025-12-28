const express = require('express');
const router = express.Router();
const User = require('../models/User');

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

router.get('/profile', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        res.render('profile', { user, message: null });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

router.post('/profile', requireLogin, async (req, res) => {
    const { sumps, egn } = req.body;
    
    try {
        await User.findByIdAndUpdate(req.session.userId, { 
            sumps: sumps,
            egn: egn
        });
        
        const user = await User.findById(req.session.userId);
        res.render('profile', { user, message: 'Данните са обновени успешно!' });
    } catch (err) {
        console.error(err);
        res.redirect('/profile');
    }
});

router.get('/register', (req, res) => {
    res.render('register');
});

router.get('/login', (req, res) => {
    res.render('login');
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

router.post('/register', async (req, res) => {
    const { email, password, sumps, egn } = req.body;
    try {
        const user = new User({ 
            email, 
            password, 
            sumps: sumps || '',
            egn: egn || ''
        });
        await user.save();
        req.session.userId = user._id;
        req.session.userEmail = user.email;
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('register', { 
            error: 'Имейлът вече е регистриран.', 
            email: email 
        });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        
        if (!user || !(await user.comparePassword(password))) {
            return res.render('login', { 
                error: 'Invalid email or password.', 
                email: email // Send the typed email back so they don't retype it
            });
        }
        
        req.session.userId = user._id;
        req.session.userEmail = user.email;
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Something went wrong.', email: email });
    }
});

module.exports = router;