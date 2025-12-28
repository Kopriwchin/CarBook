const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

const products = [
    { 
        id: 1, 
        name: 'Стандартен слот', 
        description: 'Позволява добавянето на 1 допълнителен автомобил към вашия гараж.',
        price: 1.00, 
        slots: 1,
        icon: 'fa-car'
    },
    { 
        id: 2, 
        name: 'Семеен пакет', 
        description: 'Най-изгодната оферта. Добавя 5 нови слота за автомобили.',
        price: 4.00, 
        slots: 5,
        icon: 'fa-users'
    }
];

router.get('/shop', requireLogin, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('shop/index', { products, user });
});

router.get('/checkout/:id', requireLogin, (req, res) => {
    const product = products.find(p => p.id == req.params.id);
    if (!product) return res.redirect('/shop');
    
    res.render('shop/checkout', { 
        product, 
        errors: {}, 
        formData: {} 
    });
});

router.post('/pay', requireLogin, async (req, res) => {
    const { productId, cardNumber, expiry, cvv, cardHolder } = req.body;
    const product = products.find(p => p.id == productId);

    if (!product) return res.redirect('/shop');

    let errors = {};

    const cleanCard = cardNumber.replace(/\s/g, '');
    if (!/^\d{16}$/.test(cleanCard)) {
        errors.cardNumber = 'Номерът на картата трябва да съдържа точно 16 цифри.';
    }

    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
        errors.expiry = 'Невалиден формат (MM/YY).';
    } else {
        const [month, year] = expiry.split('/').map(num => parseInt(num, 10));
        const currentYear = parseInt(new Date().getFullYear().toString().substr(-2)); 
        const currentMonth = new Date().getMonth() + 1; 

        if (month < 1 || month > 12) {
            errors.expiry = 'Невалиден месец.';
        } else if (year < currentYear || (year === currentYear && month < currentMonth)) {
            errors.expiry = 'Картата е изтекла.';
        }
    }

    if (!/^\d{3}$/.test(cvv)) {
        errors.cvv = 'CVV трябва да е 3 цифри.';
    }

    if (!cardHolder || cardHolder.trim().length < 3) {
        errors.cardHolder = 'Моля въведете името от картата.';
    }
    
    if (Object.keys(errors).length > 0) {
        return res.render('shop/checkout', { 
            product, 
            errors, 
            formData: req.body 
        });
    }

    try {
        const user = await User.findById(req.session.userId);
        const currentLimit = user.carLimit || User.DEFAULT_CAR_LIMIT_VALUE;
        user.carLimit = currentLimit + product.slots;
        await user.save();

        const newOrder = new Order({
            user: req.session.userId,
            productName: product.name,
            price: product.price,
            slotsAdded: product.slots,
            status: 'Completed'
        });
        await newOrder.save();
        
        res.redirect('/dashboard');

    } catch (err) {
        console.error(err);
        res.render('shop/checkout', { product, errors: { global: 'Възникна сървърна грешка.' }, formData: req.body });
    }
});

module.exports = router;