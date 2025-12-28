const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    brand: { type: String, required: true },
    model: { type: String, required: true },
    manufactureDate: { type: Date, required: true },
    color: { type: String, required: true },
    
    regPlate: { type: String, required: true }, 
    
    fuelType: { type: String, required: true },
    insuranceExpiry: { type: Date },
    hasFines: { type: Boolean, default: false }
});

module.exports = mongoose.model('Vehicle', vehicleSchema);