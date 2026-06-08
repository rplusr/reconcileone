/**
 * GalleryModule.js — Main WebGL Black Hole Gallery module
 * Uses Three.js for WebGL rendering. Import via ES module.
 *
 * Usage:
 *   import { GalleryModule } from './src/GalleryModule.js';
 *   const gallery = new GalleryModule({ container: document.getElementById('gallery'), cmsUrl: './cms/images.json' });
 *   await gallery.init();
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { loadImages } from './GalleryCMS.js';
import {
  tunnelVert, tunnelFrag,
  vignetteVert, vignetteFrag,
  warpVert, warpFrag
} from './shaders.js';

export class GalleryModule {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container - DOM element to attach renderer to
   * @param {string} [options.cmsUrl='./cms/images.json'] - URL to images JSON
   */
  constructor({ container, cmsUrl = './cms/images.json' } = {}) {
    if (!container) throw new Error('[GalleryModule] container is required');

    this.container = container;
    this.cmsUrl = cmsUrl;

    // Three.js internals
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._composer = null;
    this._vignettePass = null;
    this._clock = new THREE.Clock();
    this._rafId = null;

    // Image planes
    this._imageMeshes = []; // { mesh, data, zOffset, speed }
    this._textureLoader = new THREE.TextureLoader();
    this._textureCache = new Map();

    // Gallery settings (overridden by CMS data)
    this._settings = {
      speed: 0.3,
      tunnelRadius: 2.5,
      depth: 30,
      backgroundColor: '#000000'
    };

    // Mouse state
    this._mouse = { x: 0, y: 0, nx: 0, ny: 0 };
    this._targetCameraOffset = new THREE.Vector2(0, 0);
    this._currentCameraOffset = new THREE.Vector2(0, 0);

    // Hover state
    this._raycaster = new THREE.Raycaster();
    this._hoveredMesh = null;
    this._hoveredData = null;

    // Bound event handlers for cleanup
    this._onResize = this._handleResize.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onClick = this._handleClick.bind(this);

    // Overlay element
    this._overlay = null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Initialize the gallery: setup Three.js, load images, start animation.
   * @returns {Promise<void>}
   */
  async init() {
    this._setupRenderer();
    this._setupScene();
    this._setupCamera();
    this._setupPostProcessing();
    this._setupOverlay();
    this._attachEventListeners();

    const data = await loadImages(this.cmsUrl);
    if (data.gallery && data.gallery.settings) {
      Object.assign(this._settings, data.gallery.settings);
    }

    for (const imageData of data.images || []) {
      await this._createImageMesh(imageData);
    }

    this._clock.start();
    this._animate();
  }

  /**
   * Destroy the gallery, clean up all resources and event listeners.
   */
  destroy() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    window.removeEventListener('resize', this._onResize);
    this.container.removeEventListener('mousemove', this._onMouseMove);
    this.container.removeEventListener('click', this._onClick);

    // Dispose meshes
    for (const entry of this._imageMeshes) {
      this._disposeMesh(entry.mesh);
      this._scene.remove(entry.mesh);
    }
    this._imageMeshes = [];

    // Dispose textures
    for (const [, tex] of this._textureCache) tex.dispose();
    this._textureCache.clear();

    if (this._composer) {
      this._composer.renderTarget1.dispose();
      this._composer.renderTarget2.dispose();
    }

    if (this._renderer) {
      this._renderer.dispose();
      if (this._renderer.domElement.parentNode) {
        this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
      }
    }

    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }

    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._composer = null;
  }

  /**
   * Add a new image to the gallery at runtime.
   * @param {{ id: string, src: string, title: string, year?: string, medium?: string }} imageData
   */
  async addImage(imageData) {
    await this._createImageMesh(imageData);
  }

  /**
   * Remove an image from the gallery by id.
   * @param {string} id
   */
  removeImage(id) {
    const idx = this._imageMeshes.findIndex(e => e.data.id === id);
    if (idx === -1) return;

    const entry = this._imageMeshes[idx];
    this._scene.remove(entry.mesh);
    this._disposeMesh(entry.mesh);
    this._imageMeshes.splice(idx, 1);
  }

  // ─── Private: Setup ───────────────────────────────────────────────────────

  _setupRenderer() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this._renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 1);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.container.appendChild(this._renderer.domElement);
  }

  _setupScene() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x000000);
    // Subtle ambient fog that deepens the tunnel
    this._scene.fog = new THREE.FogExp2(0x000000, 0.06);
  }

  _setupCamera() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this._camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    this._camera.position.set(0, 0, 0);
    this._camera.lookAt(0, 0, -1);
  }

  _setupPostProcessing() {
    this._composer = new EffectComposer(this._renderer);
    this._composer.addPass(new RenderPass(this._scene, this._camera));

    // Vignette + Chromatic Aberration pass
    const vignetteShader = {
      uniforms: {
        tDiffuse: { value: null },
        uVignetteStrength: { value: 1.0 },
        uVignetteSmoothness: { value: 1.1 },
        uCaStrength: { value: 0.018 },
        uTime: { value: 0 }
      },
      vertexShader: vignetteVert,
      fragmentShader: vignetteFrag
    };

    this._vignettePass = new ShaderPass(vignetteShader);
    this._vignettePass.renderToScreen = true;
    this._composer.addPass(this._vignettePass);
  }

  _setupOverlay() {
    this._overlay = document.createElement('div');
    this._overlay.className = 'gallery-info-overlay';
    this._overlay.innerHTML = `
      <div class="gallery-info-title"></div>
      <div class="gallery-info-meta"></div>
    `;
    this.container.style.position = 'relative';
    this.container.appendChild(this._overlay);
  }

  _attachEventListeners() {
    window.addEventListener('resize', this._onResize);
    this.container.addEventListener('mousemove', this._onMouseMove);
    this.container.addEventListener('click', this._onClick);
  }

  // ─── Private: Image Mesh Creation ─────────────────────────────────────────

  async _createImageMesh(imageData) {
    const texture = await this._loadTexture(imageData.src);
    if (!texture) return;

    const aspectRatio = texture.image.width / texture.image.height || 4 / 3;
    const planeH = 1.4;
    const planeW = planeH * aspectRatio;

    const geometry = new THREE.PlaneGeometry(planeW, planeH, 16, 16);

    // Decide which shader to use: warp for proximity effect
    const useWarp = true;
    const vertShader = useWarp ? warpVert : tunnelVert;
    const fragShader = useWarp ? warpFrag : tunnelFrag;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
        uDistortionStrength: { value: 0.4 },
        uHover: { value: 0.0 },
        uProximity: { value: 0.0 }
      },
      vertexShader: vertShader,
      fragmentShader: fragShader,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Distribute along tunnel
    const count = this._imageMeshes.length;
    const depth = this._settings.depth;
    const radius = this._settings.tunnelRadius;

    // Spiral arrangement: evenly spaced in Z, rotated around Y axis
    const zSpacing = depth / Math.max(10, 1);
    const zPos = -(count * zSpacing * 0.7 + 2);

    // Angle around tunnel
    const angleSeed = count * (Math.PI * 0.618); // golden angle for distribution
    const xOffset = Math.cos(angleSeed) * radius * 0.85;
    const yOffset = (Math.random() - 0.5) * 0.8;

    mesh.position.set(xOffset, yOffset, zPos);

    // Tilt Y slightly (like flipping pages)
    const tiltY = angleSeed + Math.PI; // face inward
    mesh.rotation.y = tiltY;

    // Small random tilt on X for variety
    mesh.rotation.x = (Math.random() - 0.5) * 0.15;

    this._scene.add(mesh);

    this._imageMeshes.push({
      mesh,
      data: imageData,
      baseZ: zPos,
      rotY: tiltY,
      xOffset,
      yOffset,
      speed: this._settings.speed * (0.85 + Math.random() * 0.3),
      isHovered: false,
      hoverLerp: 0
    });
  }

  async _loadTexture(src) {
    if (this._textureCache.has(src)) return this._textureCache.get(src);

    return new Promise((resolve) => {
      this._textureLoader.load(
        src,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          this._textureCache.set(src, tex);
          resolve(tex);
        },
        undefined,
        (err) => {
          console.warn('[GalleryModule] Failed to load texture:', src, err);
          resolve(null);
        }
      );
    });
  }

  _disposeMesh(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (mesh.material.uniforms && mesh.material.uniforms.uTexture) {
        // Don't dispose texture here — it may be shared / in cache
      }
      mesh.material.dispose();
    }
  }

  // ─── Private: Event Handlers ───────────────────────────────────────────────

  _handleResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
    this._composer.setSize(w, h);
  }

  _handleMouseMove(e) {
    const rect = this.container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    this._mouse.nx = (x - 0.5) * 2;   // -1 to 1
    this._mouse.ny = -(y - 0.5) * 2;  // -1 to 1 (y flipped)

    // Update raycaster for hover detection
    this._raycaster.setFromCamera(
      new THREE.Vector2(this._mouse.nx, this._mouse.ny),
      this._camera
    );

    const meshes = this._imageMeshes.map(e => e.mesh);
    const intersects = this._raycaster.intersectObjects(meshes);

    const prevHovered = this._hoveredMesh;

    if (intersects.length > 0) {
      this._hoveredMesh = intersects[0].object;
      this._hoveredData = this._imageMeshes.find(e => e.mesh === this._hoveredMesh)?.data;
      this.container.style.cursor = 'pointer';
    } else {
      this._hoveredMesh = null;
      this._hoveredData = null;
      this.container.style.cursor = 'default';
    }

    if (prevHovered !== this._hoveredMesh) {
      this._updateOverlay(this._hoveredData);
    }
  }

  _handleClick(e) {
    if (this._hoveredData) {
      // Toggle overlay pin (simple toggle for now)
      const overlay = this._overlay;
      overlay.classList.toggle('pinned');
    }
  }

  _updateOverlay(data) {
    if (!this._overlay) return;
    const titleEl = this._overlay.querySelector('.gallery-info-title');
    const metaEl = this._overlay.querySelector('.gallery-info-meta');

    if (data) {
      titleEl.textContent = data.title || '';
      const parts = [data.year, data.medium].filter(Boolean);
      metaEl.textContent = parts.join(' · ');
      this._overlay.classList.add('visible');
    } else {
      this._overlay.classList.remove('visible', 'pinned');
    }
  }

  // ─── Private: Animation Loop ──────────────────────────────────────────────

  _animate() {
    this._rafId = requestAnimationFrame(() => this._animate());

    const delta = this._clock.getDelta();
    const elapsed = this._clock.getElapsedTime();
    const depth = this._settings.depth;

    // Mouse parallax: smooth camera offset
    this._targetCameraOffset.x = this._mouse.nx * 0.3;
    this._targetCameraOffset.y = this._mouse.ny * 0.2;
    this._currentCameraOffset.lerp(this._targetCameraOffset, 0.04);
    this._camera.position.x = this._currentCameraOffset.x;
    this._camera.position.y = this._currentCameraOffset.y;
    this._camera.lookAt(
      this._currentCameraOffset.x * 0.5,
      this._currentCameraOffset.y * 0.5,
      -5
    );

    // Update vignette pass time
    if (this._vignettePass) {
      this._vignettePass.uniforms.uTime.value = elapsed;
    }

    // Animate image planes
    for (const entry of this._imageMeshes) {
      const { mesh } = entry;
      const isHovered = mesh === this._hoveredMesh;

      // Hover lerp
      entry.hoverLerp = THREE.MathUtils.lerp(entry.hoverLerp, isHovered ? 1.0 : 0.0, 0.08);

      // Move along +Z (toward camera); slow when hovered
      const moveSpeed = isHovered ? entry.speed * 0.2 : entry.speed;
      mesh.position.z += moveSpeed * delta;

      // Wrap: when past camera (z > 1), teleport back
      if (mesh.position.z > 1.5) {
        mesh.position.z -= depth;
      }

      // Subtle slow rotation
      mesh.rotation.y = entry.rotY + Math.sin(elapsed * 0.2 + entry.baseZ) * 0.05;

      // Scale slightly on hover
      const targetScale = isHovered ? 1.12 : 1.0;
      const currentScale = THREE.MathUtils.lerp(mesh.scale.x, targetScale, 0.08);
      mesh.scale.setScalar(currentScale);

      // Update uniforms
      if (mesh.material.uniforms) {
        mesh.material.uniforms.uTime.value = elapsed;
        mesh.material.uniforms.uHover.value = entry.hoverLerp;

        // Proximity: 0=far, 1=near camera
        const proximity = Math.max(0, 1.0 - (-mesh.position.z / (depth * 0.5)));
        if (mesh.material.uniforms.uProximity !== undefined) {
          mesh.material.uniforms.uProximity.value = proximity;
        }
        if (mesh.material.uniforms.uDistortionStrength !== undefined) {
          mesh.material.uniforms.uDistortionStrength.value = 0.4;
        }
      }
    }

    this._composer.render();
  }
}
