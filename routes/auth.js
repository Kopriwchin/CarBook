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

    if (sumps && !/^\d{9}$/.test(sumps)) {
        const user = await User.findById(req.session.userId);
        return res.render('profile', { user, message: 'Грешка: СУМПС трябва да е 9 цифри.', error: true });
    }
    if (egn && !/^\d{10}$/.test(egn)) {
        const user = await User.findById(req.session.userId);
        return res.render('profile', { user, message: 'Грешка: ЕГН трябва да е 10 цифри.', error: true });
    }

    try {
        await User.findByIdAndUpdate(req.session.userId, { sumps, egn });
        const user = await User.findById(req.session.userId);
        res.render('profile', { user, message: 'Данните са обновени успешно!', error: false });
    } catch (err) {
        res.redirect('/profile');
    }
});

router.get('/register', (req, res) => {
    res.render('register');
});

router.post('/register', async (req, res) => {
    const { email, password, sumps, egn } = req.body;
    
    let errors = [];
    if (sumps && !/^\d{9}$/.test(sumps)) errors.push('СУМПС трябва да съдържа точно 9 цифри.');
    if (egn && !/^\d{10}$/.test(egn)) errors.push('ЕГН трябва да съдържа точно 10 цифри.');

    if (errors.length > 0) {
        return res.render('register', { 
            error: errors.join(' '), 
            email, egn, sumps 
        });
    }

    try {
        const user = new User({ email, password, sumps, egn });
        await user.save();
        req.session.userId = user._id;
        req.session.userEmail = user.email;
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('register', { error: 'Имейлът вече съществува.', email, egn, sumps });
    }
});

router.get('/login', (req, res) => {
    res.render('login');
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

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

module.exports = router;