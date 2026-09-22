// Matte clay, lit by the same key light as the terrain (it turns with the camera, F4),
// with wrap so no face goes black, a little sky from above, and a gold cast on the one
// whose card is open. The shadow variant is a soft dark disc; the decal variant is the
// glyph, in paper white, cut from the atlas. Both of those are premultiplied.
uniform vec2 uLightDir;
uniform float uFootprint;    // > 0 means this draw is the shadow disc
uniform float uDecal;        // 1 means this draw is the glyph on a peg's head
uniform sampler2D uAtlas;
in vec3 vColor;
in vec3 vNormal;
in float vSel;
in vec2 vLocal;
in vec2 vUv;
out vec4 outColor;

void main() {
  if (uDecal > 0.5) {
    float a = texture(uAtlas, vUv).a * 0.96;
    if (a < 0.01) discard;
    outColor = vec4(vec3(1.0, 0.97, 0.92) * a, a);
    return;
  }
  if (uFootprint > 0.0) {
    float r = length(vLocal);
    float a = 0.28 * smoothstep(1.0, 0.3, r);
    outColor = vec4(vec3(0.20, 0.14, 0.08) * a, a);
    return;
  }
  vec3 n = normalize(vNormal);
  vec3 L = normalize(vec3(uLightDir.x, 1.35, uLightDir.y));
  float wrap = 0.5;
  float diff = clamp((dot(n, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 col = vColor * (0.62 + 0.5 * diff) + vColor * 0.1 * max(n.y, 0.0);
  if (vSel > 0.5) col = mix(col, vec3(0.86, 0.66, 0.26), 0.3) * 1.12;
  // The colours are linear here, as every three.js colour is; the screen wants sRGB.
  outColor = linearToOutputTexel(vec4(col, 1.0));
}
