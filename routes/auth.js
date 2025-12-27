const express = require('express');
const router = express.Router();
const User = require('../models/User');

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
    const { email, password } = req.body;
    try {
        const user = new User({ email, password });
        await user.save();
        req.session.userId = user._id;
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('register', { 
            error: 'Email is already registered.', 
            email: email // Send the typed email back
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
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Something went wrong.', email: email });
    }
});


module.exports = router;