// Rangmudra — static site + admin backend, JSON-file storage.
//
// Read/writes /data/*.json directly. Designed to run locally; the public site
// is hosted on GitHub Pages and serves the same /data/*.json files, so after
// editing via the admin you commit the changed JSON + uploaded images and push.
//
//   PORT           — http port (default: 3000)
//   ADMIN_PASSCODE — admin passcode (default: "rangmudra-admin")
//
// MongoDB wiring is parked in db.js and .env.example for when this needs to
// run as a hosted backend with a real database.

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'images', 'uploads');
const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'rangmudra-admin';

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const sessions = new Set();

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf-8'));
}
function writeJson(name, value) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

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

app.get('/api/products', (_req, res) => {
  res.json(readJson('products.json'));
});

app.post('/api/admin/products', requireAuth, (req, res) => {
  const products = readJson('products.json');
  const item = req.body || {};
  if (!item.name || !item.slug) {
    return res.status(400).json({ error: 'name and slug are required' });
  }
  if (products.some((p) => p.slug === item.slug)) {
    return res.status(409).json({ error: 'A product with that slug already exists' });
  }
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
  products.push(product);
  writeJson('products.json', products);
  res.status(201).json(product);
});

app.put('/api/admin/products/:id', requireAuth, (req, res) => {
  const products = readJson('products.json');
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  products[idx] = { ...products[idx], ...req.body, id: products[idx].id };
  writeJson('products.json', products);
  res.json(products[idx]);
});

app.delete('/api/admin/products/:id', requireAuth, (req, res) => {
  const products = readJson('products.json');
  const next = products.filter((p) => p.id !== req.params.id);
  if (next.length === products.length) return res.status(404).json({ error: 'Not found' });
  writeJson('products.json', next);
  res.json({ ok: true });
});

// ---------- Workshops ----------

app.get('/api/workshops', (_req, res) => {
  res.json(readJson('workshops.json'));
});

app.post('/api/admin/workshops', requireAuth, (req, res) => {
  const workshops = readJson('workshops.json');
  const item = req.body || {};
  if (!item.title || !item.slug) {
    return res.status(400).json({ error: 'title and slug are required' });
  }
  if (workshops.some((w) => w.slug === item.slug)) {
    return res.status(409).json({ error: 'A workshop with that slug already exists' });
  }
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
  workshops.push(workshop);
  writeJson('workshops.json', workshops);
  res.status(201).json(workshop);
});

app.put('/api/admin/workshops/:id', requireAuth, (req, res) => {
  const workshops = readJson('workshops.json');
  const idx = workshops.findIndex((w) => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const current = workshops[idx];
  const patch = { ...req.body };
  delete patch.id;
  const merged = { ...current, ...patch, id: current.id };
  // Normalize price ↔ priceLabel: never store both.
  if (patch.price != null && patch.price !== '') {
    merged.price = Number(patch.price);
    merged.priceUnit = patch.priceUnit || current.priceUnit || 'per person';
    delete merged.priceLabel;
  } else if (patch.priceLabel) {
    delete merged.price;
    delete merged.priceUnit;
  }
  workshops[idx] = merged;
  writeJson('workshops.json', workshops);
  res.json(merged);
});

app.delete('/api/admin/workshops/:id', requireAuth, (req, res) => {
  const workshops = readJson('workshops.json');
  const next = workshops.filter((w) => w.id !== req.params.id);
  if (next.length === workshops.length) return res.status(404).json({ error: 'Not found' });
  writeJson('workshops.json', next);
  res.json({ ok: true });
});

// ---------- Sections ----------

app.get('/api/sections', (_req, res) => {
  res.json(readJson('sections.json'));
});

app.put('/api/admin/sections/:page/:slot', requireAuth, (req, res) => {
  const sections = readJson('sections.json');
  const { page, slot } = req.params;
  if (!sections[page] || !(slot in sections[page])) {
    return res.status(404).json({ error: 'Unknown section slot' });
  }
  const url = (req.body && req.body.url) || '';
  if (!url) return res.status(400).json({ error: 'url is required' });
  sections[page][slot] = url;
  writeJson('sections.json', sections);
  res.json({ ok: true, page, slot, url });
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

app.listen(PORT, () => {
  console.log(`Rangmudra running at http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin/   (passcode: ${ADMIN_PASSCODE})`);
});
