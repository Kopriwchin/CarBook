const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DEFAULT_CAR_LIMIT_VALUE = 1; 
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    sumps: { type: String, default: '' },
    egn: { type: String, default: '' },

    carLimit: { type: Number, default: DEFAULT_CAR_LIMIT_VALUE } 
});

userSchema.pre('save', async function() {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

User.DEFAULT_CAR_LIMIT_VALUE = DEFAULT_CAR_LIMIT_VALUE;

module.exports = User;