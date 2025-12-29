const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');


//#region middleware

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

//#endregion


//#region helpers - user & product

async function getCurrentUser(req) {
    return User.findById(req.session.userId);
}

async function getProductById(productId) {
    return Product.findById(productId);
}

//#endregion


//#region helpers - payment validation

function validateCardNumber(cardNumber) {
    const cleanCard = cardNumber.replace(/\s/g, '');
    if (!/^\d{16}$/.test(cleanCard)) {
        return 'Номерът на картата трябва да съдържа точно 16 цифри.';
    }
    return null;
}

function validateExpiry(expiry) {
    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
        return 'Невалиден формат (MM/YY).';
    }

    const parts = expiry.split('/');
    const month = parseInt(parts[0], 10);
    const year = parseInt(parts[1], 10);

    const currentYear = parseInt(new Date().getFullYear().toString().substr(-2));
    const currentMonth = new Date().getMonth() + 1;

    if (month < 1 || month > 12) {
        return 'Невалиден месец.';
    }

    if (year < currentYear || (year === currentYear && month < currentMonth)) {
        return 'Картата е изтекла.';
    }

    return null;
}

function validateCvv(cvv) {
    if (!/^\d{3}$/.test(cvv)) {
        return 'CVV трябва да е 3 цифри.';
    }
    return null;
}

function validateCardHolder(cardHolder) {
    if (!cardHolder || cardHolder.trim().length < 3) {
        return 'Моля въведете името от картата.';
    }
    return null;
}

//#endregion


//#region helpers - orders

async function applyProductToUser(user, product) {
    const currentLimit = user.carLimit || User.DEFAULT_CAR_LIMIT_VALUE || 2;
    user.carLimit = currentLimit + product.slots;
    await user.save();
}

async function createOrder(userId, product) {
    const order = new Order({
        user: userId,
        productName: product.name,
        price: product.price,
        slotsAdded: product.slots,
        status: 'Completed'
    });
    await order.save();
}

//#endregion


//#region shop

router.get('/shop', requireLogin, async (req, res) => {
    try {
        const user = await getCurrentUser(req);
        const products = await Product.find({});
        res.render('shop/index', { products, user });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
});

//#endregion


//#region checkout

router.get('/checkout/:id', requireLogin, async (req, res) => {
    try {
        const product = await getProductById(req.params.id);
        if (!product) return res.redirect('/shop');

        res.render('shop/checkout', {
            product,
            errors: {},
            formData: {}
        });
    } catch (err) {
        console.error(err);
        res.redirect('/shop');
    }
});

//#endregion


//#region payment

router.post('/pay', requireLogin, async (req, res) => {
    const { productId, cardNumber, expiry, cvv, cardHolder } = req.body;

    try {
        // Търсим продукта в базата, за да сме сигурни, че цената и слотовете са верни
        // (не вярваме на данните от фронт-енда, освен ID-то)
        const product = await getProductById(productId);
        if (!product) return res.redirect('/shop');

        const errors = {};

        const cardError = validateCardNumber(cardNumber);
        if (cardError) errors.cardNumber = cardError;

        const expiryError = validateExpiry(expiry);
        if (expiryError) errors.expiry = expiryError;

        const cvvError = validateCvv(cvv);
        if (cvvError) errors.cvv = cvvError;

        const holderError = validateCardHolder(cardHolder);
        if (holderError) errors.cardHolder = holderError;

        if (Object.keys(errors).length > 0) {
            return res.render('shop/checkout', {
                product,
                errors,
                formData: req.body
            });
        }

        const user = await getCurrentUser(req);

        await applyProductToUser(user, product);
        await createOrder(req.session.userId, product);

        res.redirect('/dashboard');

    } catch (err) {
        console.error(err);
        // Тук правя опит за повторно намиране за рендиране на грешката.
        try {
            const productRetry = await getProductById(productId);
            res.render('shop/checkout', {
                product: productRetry,
                errors: { global: 'Възникна сървърна грешка.' },
                formData: req.body
            });
        } catch (e) {
            res.redirect('/shop');
        }
    }
});

//#endregion

module.exports = router;