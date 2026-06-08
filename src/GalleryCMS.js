/**
 * GalleryCMS.js — Lightweight CMS manager for the Black Hole Gallery
 * Handles image data loading, localStorage backup, and JSON export.
 */

const STORAGE_KEY = 'blackhole_gallery_images';

/**
 * Load images from a remote JSON URL.
 * Falls back to localStorage if fetch fails.
 * @param {string} url - URL to the images.json file
 * @returns {Promise<{gallery: object, images: Array}>}
 */
export async function loadImages(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Persist to localStorage as backup
    saveImages(data.images || []);

    return data;
  } catch (err) {
    console.warn(`[GalleryCMS] Could not fetch ${url}: ${err.message}. Falling back to localStorage.`);

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const images = JSON.parse(stored);
        return {
          gallery: {
            title: 'Gallery (cached)',
            settings: defaultSettings()
          },
          images
        };
      } catch (parseErr) {
        console.error('[GalleryCMS] localStorage parse error:', parseErr);
      }
    }

    // Last resort: return empty structure
    return { gallery: { title: 'Gallery', settings: defaultSettings() }, images: [] };
  }
}

/**
 * Save images array to localStorage as backup.
 * @param {Array} images
 */
export function saveImages(images) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(images));
  } catch (err) {
    console.warn('[GalleryCMS] Could not save to localStorage:', err.message);
  }
}

/**
 * Export the current gallery data as a formatted JSON string
 * suitable for pasting into cms/images.json.
 * @param {object} galleryMeta - gallery metadata object
 * @param {Array} images - array of image objects
 * @returns {string} Formatted JSON
 */
export function exportJSON(galleryMeta, images) {
  const data = {
    gallery: galleryMeta,
    images: images
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Generate a simple unique ID for new images.
 * @returns {string}
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Validate an image object has required fields.
 * @param {object} img
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateImage(img) {
  const errors = [];
  if (!img.src || typeof img.src !== 'string') errors.push('src is required');
  if (!img.title || typeof img.title !== 'string') errors.push('title is required');
  return { valid: errors.length === 0, errors };
}

function defaultSettings() {
  return {
    speed: 0.3,
    tunnelRadius: 2.5,
    depth: 30,
    backgroundColor: '#000000'
  };
}
