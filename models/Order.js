const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productName: { type: String, required: true },
    price: { type: Number, required: true },
    slotsAdded: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    status: { type: String, default: 'Completed' }
});

module.exports = mongoose.model('Order', orderSchema);