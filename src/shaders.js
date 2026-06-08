/**
 * GLSL Shader strings for the Black Hole Gallery
 */

// --- Tunnel Image Plane Shaders ---
// Basic image plane with slight barrel distortion near edges

export const tunnelVert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vDepthFactor;

  uniform float uTime;
  uniform float uDistortionStrength;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    // depth factor: 0 near camera, 1 far away
    // camera is at z=0, images go to -depth
    vDepthFactor = clamp(-worldPos.z / 30.0, 0.0, 1.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const tunnelFrag = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vDepthFactor;

  uniform sampler2D uTexture;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uDistortionStrength;
  uniform float uHover;

  // Barrel distortion helper
  vec2 barrelDistort(vec2 uv, float strength) {
    vec2 centered = uv - 0.5;
    float r2 = dot(centered, centered);
    float distort = 1.0 + strength * r2;
    return centered * distort + 0.5;
  }

  void main() {
    // Barrel distortion increases toward edges of the tunnel (deeper images)
    float distStrength = uDistortionStrength * vDepthFactor * 0.3;
    vec2 distortedUv = barrelDistort(vUv, distStrength);

    // Clamp to avoid edge artifacts
    if (distortedUv.x < 0.0 || distortedUv.x > 1.0 ||
        distortedUv.y < 0.0 || distortedUv.y > 1.0) {
      discard;
    }

    vec4 texColor = texture2D(uTexture, distortedUv);

    // Subtle hover glow
    float glowStrength = uHover * 0.15;
    texColor.rgb += glowStrength;

    // Fade out deeply receding images
    float depthFade = 1.0 - smoothstep(0.75, 1.0, vDepthFactor);

    gl_FragColor = vec4(texColor.rgb, texColor.a * uOpacity * depthFade);
  }
`;

// --- Vignette + Chromatic Aberration Composite Shaders ---
// Fullscreen post-processing pass: aggressive vignette + CA

export const vignetteVert = /* glsl */`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const vignetteFrag = /* glsl */`
  varying vec2 vUv;

  uniform sampler2D tDiffuse;
  uniform float uVignetteStrength;    // 0-1, recommended 1.0 for black hole effect
  uniform float uVignetteSmoothness;  // falloff sharpness
  uniform float uCaStrength;          // chromatic aberration strength
  uniform float uTime;

  // Chromatic aberration: splits RGB channels by different UV offsets
  vec4 chromaticAberration(sampler2D tex, vec2 uv, float strength) {
    vec2 dir = uv - 0.5;
    float dist = length(dir);
    vec2 offset = normalize(dir) * dist * dist * strength;

    float r = texture2D(tex, uv + offset).r;
    float g = texture2D(tex, uv).g;
    float b = texture2D(tex, uv - offset).b;
    float a = texture2D(tex, uv).a;

    return vec4(r, g, b, a);
  }

  void main() {
    // Apply chromatic aberration first
    vec4 color = chromaticAberration(tDiffuse, vUv, uCaStrength);

    // Compute vignette: distance from center
    vec2 centered = vUv - 0.5;
    float dist = length(centered) * 2.0; // 0 at center, 1 at corner

    // Black hole mouth: very aggressive vignette
    // Goes fully black at ~50% from center (dist ~= 1.0 maps to corner)
    // We want it dark at dist = 0.7 (which is 50% radius from center to edge)
    float vignette = 1.0 - smoothstep(
      uVignetteSmoothness * 0.4,
      uVignetteSmoothness,
      dist * uVignetteStrength
    );

    // Clamp to avoid negatives
    vignette = clamp(vignette, 0.0, 1.0);

    // Apply vignette — black at edges merges with page background
    color.rgb *= vignette;

    // Subtle flicker/pulsing for life
    float pulse = 1.0 + sin(uTime * 0.5) * 0.01;
    color.rgb *= pulse;

    gl_FragColor = color;
  }
`;

// --- Gravitational Lensing Warp Shaders ---
// Applied per image plane as images approach the camera

export const warpVert = /* glsl */`
  varying vec2 vUv;
  varying float vProximity; // 0=far, 1=near camera

  uniform float uProximity;
  uniform float uTime;

  void main() {
    vUv = uv;
    vProximity = uProximity;

    vec3 pos = position;

    // Subtle vertex wave distortion based on proximity to camera
    float wave = sin(pos.y * 3.0 + uTime * 2.0) * uProximity * 0.02;
    pos.x += wave;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const warpFrag = /* glsl */`
  varying vec2 vUv;
  varying float vProximity;

  uniform sampler2D uTexture;
  uniform float uProximity;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uHover;

  // Gravitational lensing: radial UV displacement
  vec2 gravitationalLens(vec2 uv, float strength) {
    vec2 centered = uv - 0.5;
    float r = length(centered);
    float lensStrength = strength / (r + 0.3);
    // Pull UV toward center (inward warp) more at edges
    vec2 warped = centered * (1.0 - lensStrength * 0.08 * r);
    return warped + 0.5;
  }

  void main() {
    // Gravitational lensing intensifies as image approaches camera
    vec2 lensedUv = gravitationalLens(vUv, uProximity);

    if (lensedUv.x < 0.0 || lensedUv.x > 1.0 ||
        lensedUv.y < 0.0 || lensedUv.y > 1.0) {
      discard;
    }

    vec4 texColor = texture2D(uTexture, lensedUv);

    // Edge darkening per image (mini vignette on each plane)
    vec2 edgeDist = abs(vUv - 0.5) * 2.0;
    float edgeDark = 1.0 - pow(max(edgeDist.x, edgeDist.y), 3.0) * 0.5;
    texColor.rgb *= edgeDark;

    // Hover brightness
    texColor.rgb += uHover * 0.12;

    // Proximity fade: images fade as they pass through camera
    float proximityFade = 1.0 - smoothstep(0.85, 1.0, uProximity);

    gl_FragColor = vec4(texColor.rgb, texColor.a * uOpacity * proximityFade);
  }
`;
