const path = require('path');
const fs = require('fs');

const IS_PACKAGED = process.env.IMADE_PACKAGED === '1';
const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const USER_DATA = process.env.IMADE_USER_DATA && process.env.IMADE_USER_DATA.trim().length > 0
  ? process.env.IMADE_USER_DATA
  : PROJECT_DIR;
const DATA_ROOT = IS_PACKAGED ? USER_DATA : PROJECT_DIR;

const config = {
  HOST: process.env.HOST || '127.0.0.1',
  PORT: process.env.PORT || 18766,
  NODE_ENV: process.env.NODE_ENV || (IS_PACKAGED ? 'production' : 'development'),
  IS_PACKAGED,

  BASE_DIR: DATA_ROOT,
  DATA_DIR: path.join(DATA_ROOT, 'data'),
  INPUT_DIR: path.join(DATA_ROOT, 'input'),
  OUTPUT_DIR: path.join(DATA_ROOT, 'output'),
  THUMBNAILS_DIR: path.join(DATA_ROOT, 'thumbnails'),

  CANVAS_FILE: path.join(DATA_ROOT, 'data', 'canvas_list.json'),
  SETTINGS_FILE: path.join(DATA_ROOT, 'data', 'settings.json'),
  RH_APPS_FILE: path.join(DATA_ROOT, 'data', 'rh_apps.json'),

  FRONTEND_DIST: process.env.IMADE_FRONTEND_DIST || (IS_PACKAGED ? '' : path.join(PROJECT_DIR, 'dist')),

  THUMBNAIL_SIZE: 160,
  THUMBNAIL_QUALITY: 80,
  MAX_FILE_SIZE: 10 * 1024 * 1024,

  ZHENZHEN_BASE_URL: 'https://ai.t8star.org',
  RH_BASE_URL: 'https://www.runninghub.cn',
};

if (IS_PACKAGED) {
  for (const dir of [config.DATA_DIR, config.INPUT_DIR, config.OUTPUT_DIR, config.THUMBNAILS_DIR]) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
  }
}

module.exports = config;
