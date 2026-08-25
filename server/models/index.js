const mongoose = require('mongoose');

const { Schema } = mongoose;
const opts = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  },
};

/* ------------------------------------------------------------------ */
/* Admin user                                                          */
/* ------------------------------------------------------------------ */
const UserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, default: 'Administrator' },
    role: { type: String, enum: ['admin'], default: 'admin' },
  },
  opts
);

/* ------------------------------------------------------------------ */
/* Notice (scrolling banner queue)                                     */
/* ------------------------------------------------------------------ */
const NoticeSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['counter_closed', 'secretary_unavailable', 'office_closed', 'custom'],
      required: true,
    },
    counters: { type: [Number], default: [] }, // 1..7, only for counter_closed
    occasion: { type: String, default: '' }, // only for office_closed
    customText: { type: String, default: '' }, // only for custom
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  opts
);

/* ------------------------------------------------------------------ */
/* Vendor                                                              */
/* ------------------------------------------------------------------ */
const VendorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    location: { type: String, default: '' },
    phone: { type: String, default: '' },
    category: { type: String, default: '' },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  opts
);

/* ------------------------------------------------------------------ */
/* Advertisement                                                       */
/* ------------------------------------------------------------------ */
const AdSchema = new Schema(
  {
    businessName: { type: String, required: true, trim: true },
    caption: { type: String, default: 'Advertisement' },
    imageUrl: { type: String, default: '' },
    linkType: { type: String, enum: ['website', 'drive'], default: 'website' },
    link: { type: String, default: '' },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  opts
);

/* ------------------------------------------------------------------ */
/* Singletons (settings / links) stored as keyed documents             */
/* ------------------------------------------------------------------ */
const SingletonSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // 'settings' | 'links'
    value: { type: Schema.Types.Mixed, default: {} },
  },
  opts
);

module.exports = {
  User: mongoose.model('User', UserSchema),
  Notice: mongoose.model('Notice', NoticeSchema),
  Vendor: mongoose.model('Vendor', VendorSchema),
  Ad: mongoose.model('Ad', AdSchema),
  Singleton: mongoose.model('Singleton', SingletonSchema),
};
