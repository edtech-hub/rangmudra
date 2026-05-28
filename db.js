// MongoDB connection + collection helpers.
// Reads MONGODB_URI from env. On first connect, seeds empty collections from
// the JSON snapshots in /data/ so the admin starts populated.

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'rangmudra';
const DATA_DIR = path.join(__dirname, 'data');

let client;
let db;

async function connect() {
  if (db) return db;
  if (!URI) {
    throw new Error('MONGODB_URI is not set. Add it to .env or your shell env.');
  }
  client = new MongoClient(URI);
  await client.connect();
  db = client.db(DB_NAME);
  await ensureIndexes();
  await seedIfEmpty();
  console.log(`Connected to MongoDB: ${DB_NAME}`);
  return db;
}

async function ensureIndexes() {
  await db.collection('products').createIndex({ id: 1 }, { unique: true });
  await db.collection('products').createIndex({ slug: 1 }, { unique: true });
  await db.collection('workshops').createIndex({ id: 1 }, { unique: true });
  await db.collection('workshops').createIndex({ slug: 1 }, { unique: true });
}

async function seedIfEmpty() {
  await seedCollection('products', 'products.json');
  await seedCollection('workshops', 'workshops.json');
  const sections = await db.collection('sections').findOne({ _id: 'config' });
  if (!sections) {
    const snapshot = readJsonSafe('sections.json') || {};
    await db.collection('sections').insertOne({ _id: 'config', ...snapshot });
    console.log('Seeded sections from data/sections.json');
  }
}

async function seedCollection(name, file) {
  const count = await db.collection(name).estimatedDocumentCount();
  if (count > 0) return;
  const docs = readJsonSafe(file);
  if (!Array.isArray(docs) || !docs.length) return;
  await db.collection(name).insertMany(docs);
  console.log(`Seeded ${docs.length} ${name} from data/${file}`);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
  } catch (_) {
    return null;
  }
}

function getDb() {
  if (!db) throw new Error('DB not connected yet — call connect() first.');
  return db;
}

async function close() {
  if (client) await client.close();
  client = null;
  db = null;
}

module.exports = { connect, getDb, close };
