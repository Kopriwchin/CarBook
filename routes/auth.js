const express = require('express');
const router = express.Router();

const User = require('../models/User');

//#region middleware

const requireLogin = (req, res, next) => {
    if (!req.session.userId) 
        return res.redirect('/login');
    next();
};

//#endregion


//#region helpers - validation

function isValidSumps(sumps) {
    return /^\d{9}$/.test(sumps);
}

function isValidEgn(egn) {
    return /^\d{10}$/.test(egn);
}

//#endregion


//#region helpers - user

async function getCurrentUser(req) {
    return User.findById(req.session.userId);
}

//#endregion


//#region profile

router.get('/profile', requireLogin, async (req, res) => {
    try {
        const user = await getCurrentUser(req);
        res.render('profile', { user, message: null });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

router.post('/profile', requireLogin, async (req, res) => {
    const { sumps, egn } = req.body;

    if (sumps && !isValidSumps(sumps)) {
        const user = await getCurrentUser(req);
        return res.render('profile', {
            user,
            message: 'Грешка: СУМПС трябва да е 9 цифри.',
            error: true
        });
    }

    if (egn && !isValidEgn(egn)) {
        const user = await getCurrentUser(req);
        return res.render('profile', {
            user,
            message: 'Грешка: ЕГН трябва да е 10 цифри.',
            error: true
        });
    }

    try {
        await User.findByIdAndUpdate(req.session.userId, { sumps, egn });
        const user = await getCurrentUser(req);
        res.render('profile', {
            user,
            message: 'Данните са обновени успешно!',
            error: false
        });
    } catch (err) {
        res.redirect('/profile');
    }
});

//#endregion


//#region register

router.get('/register', (req, res) => {
    res.render('register');
});

router.post('/register', async (req, res) => {
    const { email, password, sumps, egn } = req.body;

    const errors = [];

    if (sumps && !isValidSumps(sumps)) {
        errors.push('СУМПС трябва да съдържа точно 9 цифри.');
    }

    if (egn && !isValidEgn(egn)) {
        errors.push('ЕГН трябва да съдържа точно 10 цифри.');
    }

    if (errors.length > 0) {
        return res.render('register', {
            error: errors.join(' '),
            email,
            egn,
            sumps
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
        res.render('register', {
            error: 'Имейлът вече съществува.',
            email,
            egn,
            sumps
        });
    }
});

//#endregion


//#region login

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
                email
            });
        }

        req.session.userId = user._id;
        req.session.userEmail = user.email;

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('login', {
            error: 'Something went wrong.',
            email
        });
    }
});

//#endregion


//#region logout

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

//#endregion


module.exports = router;