'use strict';

const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { migrate } = require('./migrate');

migrate();

const db = new DatabaseSync(config.storage.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

module.exports = db;
