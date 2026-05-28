// Rangmudra — static site + admin backend, backed by MongoDB Atlas.
//
//   MONGODB_URI    — Atlas connection string (required)
//   MONGODB_DB     — database name (default: "rangmudra")
//   PORT           — http port (default: 3000)
//   ADMIN_PASSCODE — admin passcode (default: "rangmudra-admin")

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connect, getDb } = require('./db');

const ROOT = __dirname;
const UPLOADS_DIR = path.join(ROOT, 'images', 'uploads');
const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'rangmudra-admin';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const sessions = new Set();

function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const safe = path.basename(file.originalname, ext)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'upload';
      const stamp = Date.now().toString(36);
      cb(null, `${safe}-${stamp}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|avif|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Unsupported file type'), ok);
  },
});

// Drop MongoDB's _id from public payloads so the admin UI sees the same shape
// it did with the JSON files.
function stripId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Auth ----------

app.post('/api/admin/login', (req, res) => {
  const { passcode } = req.body || {};
  if (passcode !== ADMIN_PASSCODE) {
    return res.status(401).json({ error: 'Incorrect passcode' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  res.json({ token });
});

app.post('/api/admin/logout', requireAuth, (req, res) => {
  sessions.delete(req.headers['x-admin-token']);
  res.json({ ok: true });
});

app.get('/api/admin/ping', requireAuth, (_req, res) => res.json({ ok: true }));

// ---------- Products ----------

app.get('/api/products', async (_req, res, next) => {
  try {
    const docs = await getDb().collection('products').find({}).toArray();
    res.json(docs.map(stripId));
  } catch (e) { next(e); }
});

app.post('/api/admin/products', requireAuth, async (req, res, next) => {
  try {
    const item = req.body || {};
    if (!item.name || !item.slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }
    const existing = await getDb().collection('products').findOne({ slug: item.slug });
    if (existing) return res.status(409).json({ error: 'A product with that slug already exists' });
    const product = {
      id: item.slug,
      slug: item.slug,
      name: item.name,
      category: item.category || "Women's Wear",
      tags: item.tags || [],
      price: Number(item.price) || 0,
      sizes: item.sizes || ['One Size'],
      printType: item.printType || 'Block Printed',
      featured: !!item.featured,
      available: item.available !== false,
      images: item.images || [],
      description: item.description || '',
      features: item.features || [],
      measurements: item.measurements || '',
      care: item.care || '',
    };
    await getDb().collection('products').insertOne(product);
    res.status(201).json(stripId(product));
  } catch (e) { next(e); }
});

app.put('/api/admin/products/:id', requireAuth, async (req, res, next) => {
  try {
    const patch = { ...req.body };
    delete patch._id;
    delete patch.id; // id is immutable (= slug)
    const result = await getDb().collection('products').findOneAndUpdate(
      { id: req.params.id },
      { $set: patch },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(stripId(result));
  } catch (e) { next(e); }
});

app.delete('/api/admin/products/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await getDb().collection('products').deleteOne({ id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Workshops ----------

app.get('/api/workshops', async (_req, res, next) => {
  try {
    const docs = await getDb().collection('workshops').find({}).toArray();
    res.json(docs.map(stripId));
  } catch (e) { next(e); }
});

app.post('/api/admin/workshops', requireAuth, async (req, res, next) => {
  try {
    const item = req.body || {};
    if (!item.title || !item.slug) {
      return res.status(400).json({ error: 'title and slug are required' });
    }
    const existing = await getDb().collection('workshops').findOne({ slug: item.slug });
    if (existing) return res.status(409).json({ error: 'A workshop with that slug already exists' });
    const category = item.category || 'experience';
    const categoryLabelMap = {
      experience: 'Experience Workshops',
      corporate: 'Corporate Workshops',
      curated: 'Curated Workshops',
    };
    const workshop = {
      id: item.slug,
      slug: item.slug,
      category,
      categoryLabel: item.categoryLabel || categoryLabelMap[category] || 'Workshops',
      title: item.title,
      level: item.level || 'All Levels',
      description: item.description || '',
      duration: item.duration || '',
      packageFor: item.packageFor || '',
      tags: item.tags || [],
      seatsBooked: Number(item.seatsBooked) || 0,
      totalSeats: Number(item.totalSeats) || 0,
      image: item.image || '',
    };
    if (item.price != null && item.price !== '') {
      workshop.price = Number(item.price);
      workshop.priceUnit = item.priceUnit || 'per person';
    } else if (item.priceLabel) {
      workshop.priceLabel = item.priceLabel;
    } else {
      workshop.priceLabel = 'Contact for pricing';
    }
    if (Array.isArray(item.includes) && item.includes.length) workshop.includes = item.includes;
    if (Array.isArray(item.idealFor) && item.idealFor.length) workshop.idealFor = item.idealFor;
    await getDb().collection('workshops').insertOne(workshop);
    res.status(201).json(stripId(workshop));
  } catch (e) { next(e); }
});

app.put('/api/admin/workshops/:id', requireAuth, async (req, res, next) => {
  try {
    const patch = { ...req.body };
    delete patch._id;
    delete patch.id;
    const col = getDb().collection('workshops');
    const current = await col.findOne({ id: req.params.id });
    if (!current) return res.status(404).json({ error: 'Not found' });
    const update = { $set: {}, $unset: {} };
    Object.entries(patch).forEach(([k, v]) => { update.$set[k] = v; });
    // Normalize price ↔ priceLabel: never store both.
    if (patch.price != null && patch.price !== '') {
      update.$set.price = Number(patch.price);
      update.$set.priceUnit = patch.priceUnit || current.priceUnit || 'per person';
      update.$unset.priceLabel = '';
    } else if (patch.priceLabel) {
      update.$unset.price = '';
      update.$unset.priceUnit = '';
    }
    if (!Object.keys(update.$unset).length) delete update.$unset;
    const result = await col.findOneAndUpdate(
      { id: req.params.id },
      update,
      { returnDocument: 'after' },
    );
    res.json(stripId(result));
  } catch (e) { next(e); }
});

app.delete('/api/admin/workshops/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await getDb().collection('workshops').deleteOne({ id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Sections ----------

app.get('/api/sections', async (_req, res, next) => {
  try {
    const doc = await getDb().collection('sections').findOne({ _id: 'config' });
    res.json(stripId(doc) || {});
  } catch (e) { next(e); }
});

app.put('/api/admin/sections/:page/:slot', requireAuth, async (req, res, next) => {
  try {
    const { page, slot } = req.params;
    const url = (req.body && req.body.url) || '';
    if (!url) return res.status(400).json({ error: 'url is required' });
    const doc = await getDb().collection('sections').findOne({ _id: 'config' });
    if (!doc || !doc[page] || !(slot in doc[page])) {
      return res.status(404).json({ error: 'Unknown section slot' });
    }
    await getDb().collection('sections').updateOne(
      { _id: 'config' },
      { $set: { [`${page}.${slot}`]: url } },
    );
    res.json({ ok: true, page, slot, url });
  } catch (e) { next(e); }
});

// ---------- Uploads ----------

app.post('/api/admin/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/images/uploads/${req.file.filename}` });
});

// ---------- Static ----------

// Several placeholder files under /images/ are named .jpg but contain SVG
// markup. Sniff the first byte; if it's `<`, serve as image/svg+xml so the
// browser actually renders it instead of treating it as a corrupt JPEG.
app.get(/^\/images\/.+\.(jpe?g|png|webp|gif)$/i, (req, res, next) => {
  const filePath = path.join(ROOT, decodeURIComponent(req.path));
  fs.open(filePath, 'r', (err, fd) => {
    if (err) return next();
    const buf = Buffer.alloc(1);
    fs.read(fd, buf, 0, 1, 0, (readErr) => {
      fs.close(fd, () => {});
      if (readErr) return next();
      if (buf[0] === 0x3C /* < */) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-store');
        return res.sendFile(filePath);
      }
      next();
    });
  });
});

app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

(async () => {
  try {
    await connect();
  } catch (e) {
    console.error('Failed to connect to MongoDB:', e.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Rangmudra running at http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin/   (passcode: ${ADMIN_PASSCODE})`);
  });
})();
